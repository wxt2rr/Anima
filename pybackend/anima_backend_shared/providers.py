import json
import os
import re
import shutil
import select
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Protocol, Union


@dataclass(frozen=True)
class ProviderSpec:
    provider_id: str
    provider_type: str
    base_url: str
    api_key: str
    model: str
    proxy_url: str
    thinking_enabled: bool
    api_format: str
    use_max_completion_tokens: bool
    extra_headers: Dict[str, str] = field(default_factory=dict)


class ChatProvider(Protocol):
    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]: ...


def normalize_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    # If it ends with /v<number>, assume it's a valid versioned endpoint
    if re.search(r"/v\d+$", trimmed):
        return trimmed
    # If it already has /v1 (legacy check, covered by regex but kept for clarity)
    if trimmed.endswith("/v1"):
        return trimmed
    return trimmed + "/v1"

def normalize_proxy_url(proxy_url: str) -> str:
    s = str(proxy_url or "").strip()
    if not s:
        return ""
    lower = s.lower()
    if "://" in lower:
        return s
    if s.startswith("/"):
        return s
    if ":" in s:
        return "http://" + s
    return s


def _auth_header_value(api_key: str) -> str:
    s = str(api_key or "").strip()
    if not s:
        return ""
    lower = s.lower()
    if lower.startswith("bearer ") or lower.startswith("basic ") or lower.startswith("token "):
        return s
    return f"Bearer {s}"


def _parse_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        return int(float(s))
    except Exception:
        return None


def _parse_duration_to_ms(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        s = str(value).strip().lower()
        if not s:
            return None
        if s.isdigit():
            return int(s) * 1000
        num = ""
        unit = ""
        for ch in s:
            if ch.isdigit() or ch == ".":
                num += ch
            else:
                unit += ch
        if not num:
            return None
        n = float(num)
        u = unit.strip() or "s"
        mult = {
            "ms": 1,
            "s": 1000,
            "sec": 1000,
            "secs": 1000,
            "m": 60 * 1000,
            "min": 60 * 1000,
            "mins": 60 * 1000,
            "h": 60 * 60 * 1000,
            "hr": 60 * 60 * 1000,
            "hrs": 60 * 60 * 1000,
            "d": 24 * 60 * 60 * 1000,
        }.get(u)
        if mult is None:
            return None
        return int(n * mult)
    except Exception:
        return None


def fetch_provider_models(base_url: str, api_key: str) -> List[Dict[str, Any]]:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("base_url is required")

    candidates: List[str] = []
    candidates.append(normalize_base_url(base) + "/models")
    candidates.append(base + "/models")
    seen = set()
    unique_candidates: List[str] = []
    for u in candidates:
        if u not in seen:
            seen.add(u)
            unique_candidates.append(u)

    last_error: Optional[Exception] = None
    for url in unique_candidates:
        req = urllib.request.Request(url)
        if api_key:
            req.add_header("Authorization", _auth_header_value(api_key))
        req.add_header("Accept", "application/json")
        req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status != 200:
                    raise Exception(f"HTTP {response.status}")
                data = json.loads(response.read().decode("utf-8"))
                if "data" in data and isinstance(data["data"], list):
                    return data["data"]
                return []
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")
            except Exception:
                body = ""

            if e.code in (404, 405):
                last_error = RuntimeError(f"Upstream HTTP {e.code} at {url}: {body[:4000]}")
                continue
            raise RuntimeError(f"Upstream HTTP {e.code} at {url}: {body[:4000]}")
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(str(last_error) if last_error else "Failed to fetch models")


def _header_get(headers: Any, key: str) -> Optional[str]:
    try:
        if headers is None:
            return None
        if hasattr(headers, "get"):
            v = headers.get(key)
            if v is None:
                v = headers.get(key.lower())
            if v is None:
                v = headers.get(key.upper())
            return str(v).strip() if v is not None else None
        return None
    except Exception:
        return None


def _extract_rate_limit(headers: Any) -> Optional[Dict[str, Any]]:
    remaining = (
        _parse_int(_header_get(headers, "x-ratelimit-remaining-tokens"))
        or _parse_int(_header_get(headers, "anthropic-ratelimit-remaining-tokens"))
    )
    limit = _parse_int(_header_get(headers, "x-ratelimit-limit-tokens")) or _parse_int(
        _header_get(headers, "anthropic-ratelimit-limit-tokens")
    )
    reset_ms = (
        _parse_duration_to_ms(_header_get(headers, "x-ratelimit-reset-tokens"))
        or _parse_duration_to_ms(_header_get(headers, "anthropic-ratelimit-reset-tokens"))
    )
    out: Dict[str, Any] = {}
    if remaining is not None:
        out["remainingTokens"] = remaining
    if limit is not None:
        out["limitTokens"] = limit
    if reset_ms is not None:
        out["resetMs"] = reset_ms
    return out or None


class OpenAIChatProvider:
    def __init__(self, spec: ProviderSpec):
        self._spec = spec
        self.include_reasoning_content_in_messages = False
        self.last_rate_limit: Optional[Dict[str, Any]] = None

    def chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        endpoint = "/chat/completions"
        if self._spec.api_format == "responses":
            endpoint = "/responses"

        url = normalize_base_url(self._spec.base_url) + endpoint
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)
        if self._spec.extra_headers:
            headers.update(self._spec.extra_headers)
        if "User-Agent" not in headers and "user-agent" not in {k.lower(): k for k in headers.keys()}:
            headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) anima/0.1.0 Chrome/124.0.6367.243 Electron/30.5.1 Safari/537.36"

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        payload: Dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature, "stream": True}
        if extra_body:
            payload.update(extra_body)
        if max_tokens and max_tokens > 0:
            if self._spec.use_max_completion_tokens:
                payload["max_completion_tokens"] = max_tokens
            else:
                payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice

        data = json.dumps(payload).encode("utf-8")

        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            px = normalize_proxy_url(self._spec.proxy_url)
            handlers.append(urllib.request.ProxyHandler({"http": px, "https": px}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                info = getattr(resp, "headers", None) or resp.info()
                content_type = str((info.get("Content-Type") if info is not None else "") or "").lower()
                if content_type and "text/event-stream" not in content_type:
                    try:
                        raw = resp.read(4096)
                    except Exception:
                        raw = b""
                    body_preview = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
                    body_preview = body_preview.replace("\r\n", "\n").replace("\r", "\n").strip()
                    raise RuntimeError(f"Upstream did not return text/event-stream (contentType={content_type}) bodyPreview={body_preview[:800]}")

                saw_data = False
                first_non_data: str | None = None
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        if first_non_data is None and line:
                            first_non_data = line[:400]
                        continue
                    saw_data = True
                    data_text = line[len("data:") :].strip()
                    if not data_text:
                        continue
                    if data_text == "[DONE]":
                        break
                    try:
                        evt = json.loads(data_text)
                    except Exception:
                        continue
                    if isinstance(evt, dict):
                        yield evt
                if not saw_data:
                    raise RuntimeError(f"Upstream stream produced no SSE data lines (contentType={content_type or 'unknown'}) firstLine={first_non_data or ''}")
        except socket.timeout as e:
            raise RuntimeError("Upstream stream timed out") from e
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"Upstream HTTP {e.code}: {body[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        except Exception as e:
            raise RuntimeError(str(e))


class OpenAICodexChatProvider(OpenAIChatProvider):
    def __init__(self, spec: ProviderSpec):
        super().__init__(spec)
        self._codex_first_byte_timeout_s = 20
        self._codex_idle_timeout_s = 45
        self._codex_total_timeout_s = 180

    def _codex_url(self) -> str:
        base = str(self._spec.base_url or "").strip().rstrip("/")
        if len(base) >= 2 and base[0] == base[-1] and base[0] in ("`", "'", '"'):
            base = base[1:-1].strip().rstrip("/")
        if base.endswith("/backend-api"):
            return base + "/codex/responses"
        if base.endswith("/backend-api/codex"):
            return base + "/responses"
        if "/backend-api/" in base and base.endswith("/codex"):
            return base + "/responses"
        if "/backend-api/" in base and base.endswith("/codex/responses"):
            return base
        if "/backend-api/" in base and base.endswith("/responses"):
            return base
        return base + "/codex/responses"

    def _codex_debug_enabled(self) -> bool:
        v = str(os.environ.get("ANIMA_CODEX_DEBUG") or os.environ.get("ANIMA_DEBUG_CODEX") or "").strip().lower()
        return v in ("1", "true", "yes", "on")

    def _codex_debug(self, msg: str) -> None:
        if not self._codex_debug_enabled():
            return
        try:
            sys.stderr.write(f"[codex_debug] {msg}\n")
            sys.stderr.flush()
        except Exception:
            pass

    def _codex_redact(self, v: Any) -> str:
        s = str(v or "")
        if not s:
            return ""
        if len(s) <= 12:
            return "***"
        return s[:4] + "..." + s[-4:]

    def _codex_debug_request(self, kind: str, url: str, headers: Dict[str, str], payload: Dict[str, Any], args: Optional[List[str]] = None) -> None:
        if not self._codex_debug_enabled():
            return
        safe_headers: Dict[str, str] = {}
        for k, v in (headers or {}).items():
            lk = str(k or "").strip().lower()
            if lk in ("authorization", "cookie"):
                safe_headers[str(k)] = self._codex_redact(v)
            else:
                safe_headers[str(k)] = str(v)

        instructions = payload.get("instructions")
        inp = payload.get("input")
        input_summary = []
        if isinstance(inp, list):
            for m in inp[:10]:
                if isinstance(m, dict):
                    r = str(m.get("role") or "")
                    c = str(m.get("content") or "")
                    input_summary.append({"role": r, "contentLen": len(c)})
        summary = {
            "kind": kind,
            "url": url,
            "headers": dict(sorted(safe_headers.items(), key=lambda kv: kv[0].lower())),
            "payloadKeys": sorted([str(k) for k in (payload or {}).keys()]),
            "model": str(payload.get("model") or ""),
            "stream": bool(payload.get("stream") is True),
            "store": payload.get("store"),
            "instructionsLen": len(str(instructions or "")),
            "inputSummary": input_summary,
        }
        self._codex_debug("request=" + json.dumps(summary, ensure_ascii=False))
        if args:
            safe_args: List[str] = []
            skip_next = False
            for i, a in enumerate(args):
                if skip_next:
                    skip_next = False
                    continue
                if a == "-H" and i + 1 < len(args):
                    hv = str(args[i + 1])
                    if hv.lower().startswith("authorization:"):
                        safe_args.extend(["-H", "Authorization: " + self._codex_redact(hv.split(":", 1)[1].strip())])
                    elif hv.lower().startswith("cookie:"):
                        safe_args.extend(["-H", "Cookie: " + self._codex_redact(hv.split(":", 1)[1].strip())])
                    else:
                        safe_args.extend(["-H", hv])
                    skip_next = True
                    continue
                safe_args.append(str(a))
            self._codex_debug("curl_args=" + " ".join(safe_args))

    def _codex_payload(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        model_override: Optional[str],
        extra_body: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        actual_model = str(model_override or self._spec.model or "").strip()
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        reasoning_effort = None
        base_model = actual_model
        for suffix in ("-low", "-medium", "-high", "-xhigh"):
            if actual_model.endswith(suffix):
                base_model = actual_model[: -len(suffix)]
                reasoning_effort = suffix[1:]
                break

        inp: List[Dict[str, str]] = []
        instructions_parts: List[str] = []
        for m in messages or []:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "").strip().lower()
            content = str(m.get("content") or "")
            if role == "system":
                if content.strip():
                    instructions_parts.append(content)
            elif role == "user":
                inp.append({"role": "user", "content": content})
            elif role == "assistant":
                inp.append({"role": "assistant", "content": content})
            else:
                continue

        instructions = "\n\n".join([x for x in instructions_parts if str(x).strip()]).strip()
        if not instructions:
            instructions = "You are a helpful assistant."

        payload: Dict[str, Any] = {
            "model": base_model,
            "instructions": instructions,
            "input": inp,
            "store": False,
            "stream": True,
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if isinstance(extra_body, dict):
            for k, v in extra_body.items():
                if k in ("model", "input", "store", "stream"):
                    continue
                if k in ("temperature", "max_tokens", "max_output_tokens"):
                    continue
                payload[k] = v
        return payload

    def _extract_text_delta(self, evt: Dict[str, Any]) -> str:
        t = str(evt.get("type") or "").strip()
        if t == "error":
            err = evt.get("error")
            if isinstance(err, dict):
                msg = str(err.get("message") or "").strip()
                if msg:
                    raise RuntimeError(msg)
            raise RuntimeError("Codex upstream error")

        if t.endswith("output_text.delta") or t.endswith("output_text.stream") or t.endswith("output_text.chunk"):
            v = evt.get("delta")
            if isinstance(v, str) and v:
                return v
            v = evt.get("text")
            if isinstance(v, str) and v:
                return v
            ot = evt.get("output_text")
            if isinstance(ot, dict):
                v = ot.get("delta")
                if isinstance(v, str) and v:
                    return v
                v = ot.get("text")
                if isinstance(v, str) and v:
                    return v
            return ""

        if t.endswith("message.delta") or t.endswith("message.stream"):
            v = evt.get("delta")
            if isinstance(v, str) and v:
                return v
            msg = evt.get("message")
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str) and c:
                    return c
                if isinstance(c, list):
                    out = ""
                    for part in c:
                        if isinstance(part, dict):
                            txt = part.get("text")
                            if isinstance(txt, str) and txt:
                                out += txt
                    return out
            return ""

        return ""

    def _extract_text(self, evt: Dict[str, Any]) -> str:
        t = str(evt.get("type") or "").strip()
        if t == "error":
            err = evt.get("error")
            if isinstance(err, dict):
                msg = str(err.get("message") or "").strip()
                if msg:
                    raise RuntimeError(msg)
            raise RuntimeError("Codex upstream error")
        if t not in ("response.ongoing", "response.done"):
            return ""
        resp = evt.get("response")
        if not isinstance(resp, dict):
            return ""
        output = resp.get("output")
        if not isinstance(output, list):
            return ""
        text = ""
        for item in output:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "").strip() != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "").strip() != "output_text":
                    continue
                val = part.get("text")
                if isinstance(val, str) and val:
                    text += val
        return text

    def _extract_text_from_response_obj(self, resp: Dict[str, Any]) -> str:
        output = resp.get("output")
        if not isinstance(output, list):
            return ""
        text = ""
        for item in output:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "").strip() != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "").strip() != "output_text":
                    continue
                val = part.get("text")
                if isinstance(val, str) and val:
                    text += val
        return text

    def _codex_request_json(self, url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout_s: int) -> Dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            px = normalize_proxy_url(self._spec.proxy_url)
            handlers.append(urllib.request.ProxyHandler({"http": px, "https": px}))
        opener = urllib.request.build_opener(*handlers)
        try:
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                obj = json.loads(raw.decode("utf-8"))
                return obj if isinstance(obj, dict) else {"_payload": obj}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"Upstream HTTP {e.code}: {body[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )

    def _codex_request_stream_to_text(self, url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout_s: int) -> str:
        curl = shutil.which("curl")
        if not curl:
            raise RuntimeError("curl not found; cannot call ChatGPT Codex backend from Python runtime")

        data = json.dumps(payload).encode("utf-8")
        args: List[str] = [
            curl,
            "-sS",
            "-N",
            "--http1.1",
            "--connect-timeout",
            "60",
            "--max-time",
            str(max(1, int(timeout_s))),
            "-D",
            "-",
            "-X",
            "POST",
            url,
        ]
        if self._spec.proxy_url:
            args.extend(["-x", normalize_proxy_url(self._spec.proxy_url)])
        for k, v in headers.items():
            vv = str(v or "")
            if vv:
                args.extend(["-H", f"{k}: {vv}"])
        args.extend(["--data-binary", "@-"])
        self._codex_debug(f"fallback_stream url={url} timeout_s={timeout_s}")
        self._codex_debug_request("fallback_stream", url, headers, payload, args=args)

        p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if p.stdin is None or p.stdout is None or p.stderr is None:
            raise RuntimeError("Failed to start curl process")
        try:
            p.stdin.write(data)
            p.stdin.close()
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
            raise

        status_code: Optional[int] = None
        in_headers = True
        previous = ""
        first_non_sse_body = ""
        start_at = time.time()
        timed_out = False
        lines_logged = 0
        max_lines = 80
        while True:
            if time.time() - start_at > float(timeout_s):
                timed_out = True
                break
            try:
                r, _w, _e = select.select([p.stdout], [], [], 1)
            except Exception:
                r = [p.stdout]
            if not r:
                continue
            raw_line = p.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="ignore").rstrip("\n").rstrip("\r")
            if lines_logged < max_lines:
                self._codex_debug(f"fallback_stream raw={line[:2000]}")
                lines_logged += 1
            if not in_headers and line.upper().startswith("HTTP/"):
                in_headers = True
                status_code = None
            if in_headers:
                if not line.strip():
                    in_headers = False
                    if status_code is not None and status_code >= 400:
                        rest = p.stdout.read(4096).decode("utf-8", errors="ignore")
                        body_preview = (rest or "").replace("\r\n", "\n").replace("\r", "\n").strip()
                        try:
                            p.kill()
                        except Exception:
                            pass
                        raise RuntimeError(
                            f"Upstream HTTP {status_code}: {(body_preview or '').strip()[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
                        )
                    continue
                if status_code is None and line.upper().startswith("HTTP/"):
                    parts = line.split()
                    if len(parts) >= 2 and parts[1].isdigit():
                        try:
                            status_code = int(parts[1])
                        except Exception:
                            status_code = None
                continue

            s = line.strip()
            if not s:
                continue
            if not s.startswith("data:"):
                if not first_non_sse_body and s:
                    first_non_sse_body = s
                continue
            data_text = s[len("data:") :].strip()
            if not data_text:
                continue
            if data_text == "[DONE]":
                break
            if lines_logged < max_lines:
                self._codex_debug(f"fallback_stream data={data_text[:2000]}")
                lines_logged += 1
            try:
                evt = json.loads(data_text)
            except Exception:
                continue
            if not isinstance(evt, dict):
                continue
            delta = self._extract_text_delta(evt)
            if delta:
                previous += delta
            else:
                full = self._extract_text(evt)
                if full:
                    previous = full

            t = str(evt.get("type") or "").strip()
            if t == "response.done" or t.endswith(".done"):
                break

        if timed_out and p.poll() is None:
            try:
                p.terminate()
            except Exception:
                pass
            try:
                p.wait(timeout=2)
            except Exception:
                pass
        if timed_out and p.poll() is None:
            try:
                p.kill()
            except Exception:
                pass
            try:
                p.wait(timeout=2)
            except Exception:
                pass

        rc = p.poll()
        if rc is None:
            try:
                rc = p.wait(timeout=3)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
                rc = p.wait(timeout=3)

        if timed_out:
            err = p.stderr.read().decode("utf-8", errors="ignore")
            err = err.replace("\r\n", "\n").replace("\r", "\n").strip()
            if err:
                self._codex_debug(f"fallback_stream timeout_s={timeout_s} stderr={err[:2000]}")
            raise RuntimeError(
                f"Codex upstream timeout after {int(timeout_s)}s | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        if rc != 0:
            err = p.stderr.read().decode("utf-8", errors="ignore")
            err = err.replace("\r\n", "\n").replace("\r", "\n").strip()
            self._codex_debug(f"fallback_stream rc={rc} stderr={err[:2000]}")
            if isinstance(rc, int) and rc < 0:
                sig = -rc
                raise RuntimeError(
                    f"curl terminated by signal {sig}: {err[:2000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
                )
            raise RuntimeError(
                f"curl failed rc={rc}: {err[:2000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )

        out = str(previous or "").strip()
        if not out:
            preview = str(first_non_sse_body or "").strip()
            if preview:
                raise RuntimeError(f"Codex upstream returned empty response (firstLine={preview[:4000]})")
        return out

    def chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        if tools or tool_choice is not None:
            raise RuntimeError("Codex provider does not support tools yet")

        url = self._codex_url()
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)
        if self._spec.extra_headers:
            headers.update(self._spec.extra_headers)
        if "User-Agent" not in headers and "user-agent" not in {k.lower(): k for k in headers.keys()}:
            headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) anima/0.1.0 Chrome/124.0.6367.243 Electron/30.5.1 Safari/537.36"

        payload = self._codex_payload(messages, temperature, max_tokens, model_override, extra_body)
        data = json.dumps(payload).encode("utf-8")

        curl = shutil.which("curl")
        if not curl:
            raise RuntimeError("curl not found; cannot call ChatGPT Codex backend from Python runtime")

        args: List[str] = [
            curl,
            "-sS",
            "-N",
            "--http1.1",
            "--connect-timeout",
            "60",
            "--max-time",
            str(self._codex_total_timeout_s),
            "-D",
            "-",
            "-X",
            "POST",
            url,
        ]
        if self._spec.proxy_url:
            args.extend(["-x", normalize_proxy_url(self._spec.proxy_url)])
        for k, v in headers.items():
            if v is None:
                continue
            vv = str(v)
            if not vv:
                continue
            args.extend(["-H", f"{k}: {vv}"])
        args.extend(["--data-binary", "@-"])
        self._codex_debug(f"stream url={url} connect_timeout=60 total_timeout={self._codex_total_timeout_s}")
        self._codex_debug_request("stream", url, headers, payload, args=args)

        p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if p.stdin is None or p.stdout is None or p.stderr is None:
            raise RuntimeError("Failed to start curl process")
        try:
            p.stdin.write(data)
            p.stdin.close()
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
            raise

        status_code: Optional[int] = None
        in_headers = True
        header_lines: List[str] = []
        previous = ""
        body_preview = ""
        start_at = time.time()
        yielded_any = False
        yielded_stop = False
        used_fallback = False
        lines_logged = 0
        max_lines = 120

        def _readline(timeout_s: int) -> Optional[bytes]:
            if p.stdout is None:
                return None
            try:
                r, _w, _e = select.select([p.stdout], [], [], max(0, int(timeout_s)))
            except Exception:
                r = [p.stdout]
            if not r:
                return None
            try:
                return p.stdout.readline()
            except Exception:
                return None

        def _fallback_once() -> Iterator[Dict[str, Any]]:
            full_text = self._codex_request_stream_to_text(url, headers, payload, timeout_s=60)
            if not full_text:
                raise RuntimeError("Codex upstream returned empty response")
            yield {"choices": [{"delta": {"content": full_text}, "finish_reason": None}]}
            yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

        while True:
            elapsed = time.time() - start_at
            if elapsed > self._codex_total_timeout_s:
                try:
                    p.kill()
                except Exception:
                    pass
                used_fallback = True
                for e in _fallback_once():
                    yield e
                break

            timeout_s = self._codex_first_byte_timeout_s if in_headers else self._codex_idle_timeout_s
            raw_line = _readline(timeout_s)
            if raw_line is None:
                try:
                    p.kill()
                except Exception:
                    pass
                used_fallback = True
                for e in _fallback_once():
                    yield e
                break
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="ignore").rstrip("\n").rstrip("\r")
            if lines_logged < max_lines:
                self._codex_debug(f"stream raw={line[:2000]}")
                lines_logged += 1
            if not in_headers and line.upper().startswith("HTTP/"):
                in_headers = True
                status_code = None

            if in_headers:
                if not line.strip():
                    in_headers = False
                    if status_code is not None and status_code >= 400:
                        rest = p.stdout.read(4096).decode("utf-8", errors="ignore")
                        body_preview = (rest or "").replace("\r\n", "\n").replace("\r", "\n").strip()
                        try:
                            p.kill()
                        except Exception:
                            pass
                        raise RuntimeError(
                            f"Upstream HTTP {status_code}: {(body_preview or '').strip()[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
                        )
                    continue

                header_lines.append(line)
                if status_code is None and line.upper().startswith("HTTP/"):
                    parts = line.split()
                    if len(parts) >= 2 and parts[1].isdigit():
                        try:
                            status_code = int(parts[1])
                        except Exception:
                            status_code = None
                continue

            s = line.strip()
            if not s:
                continue
            if not s.startswith("data:"):
                if not previous and not body_preview and s.startswith("<"):
                    body_preview = s
                continue
            data_text = s[len("data:") :].strip()
            if not data_text:
                continue
            if data_text == "[DONE]":
                break
            if lines_logged < max_lines:
                self._codex_debug(f"stream data={data_text[:2000]}")
                lines_logged += 1
            try:
                evt = json.loads(data_text)
            except Exception:
                continue
            if not isinstance(evt, dict):
                continue
            delta = self._extract_text_delta(evt)
            if delta:
                previous += delta
                yielded_any = True
                yield {"choices": [{"delta": {"content": delta}, "finish_reason": None}]}

            full = "" if delta else self._extract_text(evt)
            if full and len(full) > len(previous):
                delta2 = full[len(previous) :]
                previous = full
                yielded_any = True
                if delta2:
                    yield {"choices": [{"delta": {"content": delta2}, "finish_reason": None}]}

            t = str(evt.get("type") or "").strip()
            if t == "response.done" or t.endswith(".done"):
                yielded_any = True
                yielded_stop = True
                yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}
                break

        try:
            rc = p.wait(timeout=5)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
            rc = p.wait(timeout=5)
        if used_fallback:
            return
        if rc != 0:
            err = p.stderr.read().decode("utf-8", errors="ignore")
            err = err.replace("\r\n", "\n").replace("\r", "\n").strip()
            self._codex_debug(f"stream rc={rc} stderr={err[:2000]}")
            if isinstance(rc, int) and rc < 0:
                if not yielded_any:
                    used_fallback = True
                    try:
                        for e in _fallback_once():
                            yield e
                        return
                    except Exception as e:
                        sig = -rc
                        raise RuntimeError(
                            f"curl terminated by signal {sig}: {err[:2000]} | fallbackError={str(e)[:2000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
                        )
                sig = -rc
                raise RuntimeError(
                    f"curl terminated by signal {sig}: {err[:2000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
                )
            raise RuntimeError(
                f"curl failed rc={rc}: {err[:2000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} proxyUrl={normalize_proxy_url(self._spec.proxy_url)} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        if not yielded_any:
            for e in _fallback_once():
                yield e
            return
        if previous and not yielded_stop:
            yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}
            return

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        content = ""
        for evt in self.chat_completion_stream(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools,
            tool_choice=tool_choice,
            model_override=model_override,
            extra_body=extra_body,
        ):
            choice = ((evt.get("choices") or [{}])[0]) if isinstance(evt, dict) else {}
            delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
            part = delta.get("content")
            if isinstance(part, str) and part:
                content += part
        return {"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}]}


def _provider_spec_from_obj(settings_obj: Dict[str, Any], provider_obj: Dict[str, Any]) -> Optional[ProviderSpec]:
    cfg = provider_obj.get("config") or {}
    if not isinstance(cfg, dict):
        return None

    provider_id = str(provider_obj.get("id") or "").strip() or "provider"
    provider_type = str(provider_obj.get("type") or "openai").strip() or "openai"
    base_url = str(cfg.get("baseUrl") or "").strip()
    if len(base_url) >= 2 and base_url[0] == base_url[-1] and base_url[0] in ("`", "'", '"'):
        base_url = base_url[1:-1].strip()
    api_key = ""
    model = str(cfg.get("selectedModel") or "").strip()
    if not model:
        models = cfg.get("models") or []
        if isinstance(models, list) and models:
            model = str(models[0] or "").strip()
    proxy_url = str((settings_obj.get("settings") or {}).get("proxyUrl") or "").strip()
    thinking_enabled = bool(cfg.get("thinkingEnabled") is True)
    api_format = str(cfg.get("apiFormat") or "chat_completions").strip()
    use_max_completion_tokens = bool(cfg.get("useMaxCompletionTokens") is True)
    extra_headers: Dict[str, str] = {}

    if not base_url:
        return None
    profile_id = None
    try:
        from .qwen_auth_runtime import get_qwen_profile_id_from_provider_obj

        profile_id = get_qwen_profile_id_from_provider_obj(provider_obj)
    except Exception:
        profile_id = None

    if profile_id is not None:
        try:
            from .qwen_auth_runtime import resolve_qwen_access_token

            api_key = resolve_qwen_access_token(provider_id, profile_id)
        except Exception as e:
            raise RuntimeError(str(e))
        provider_type = "openai_compatible"
        if not api_format:
            api_format = "chat_completions"
    else:
        codex_profile_id = None
        try:
            from .openai_codex_auth_runtime import get_openai_codex_profile_id_from_provider_obj

            codex_profile_id = get_openai_codex_profile_id_from_provider_obj(provider_obj)
        except Exception:
            codex_profile_id = None

        if codex_profile_id is not None:
            try:
                from .openai_codex_auth_runtime import resolve_openai_codex_access_token

                token, account_id = resolve_openai_codex_access_token(provider_id, codex_profile_id)
                api_key = token
                extra_headers = {
                    "chatgpt-account-id": account_id,
                    "OpenAI-Beta": "responses=experimental",
                    "originator": "codex_cli_rs",
                }
            except Exception as e:
                raise RuntimeError(str(e))
            provider_type = "openai_codex"
            api_format = "responses"
        else:
            api_key = str(cfg.get("apiKey") or "").strip()
    return ProviderSpec(
        provider_id=provider_id,
        provider_type=provider_type,
        base_url=base_url,
        api_key=api_key,
        model=model,
        proxy_url=proxy_url,
        thinking_enabled=thinking_enabled,
        api_format=api_format,
        use_max_completion_tokens=use_max_completion_tokens,
        extra_headers=extra_headers,
    )


def get_provider_spec(settings_obj: Dict[str, Any], provider_id: Optional[str] = None) -> Optional[ProviderSpec]:
    providers = settings_obj.get("providers") or []
    if not isinstance(providers, list):
        return None

    pid = str(provider_id or "").strip()
    if pid:
        for p in providers:
            if not isinstance(p, dict):
                continue
            if str(p.get("id") or "").strip().lower() == pid.lower():
                return _provider_spec_from_obj(settings_obj, p)
        return None

    active = None
    for p in providers:
        if isinstance(p, dict) and p.get("isEnabled") is True:
            active = p
            break
    if not isinstance(active, dict):
        return None
    return _provider_spec_from_obj(settings_obj, active)


def get_active_provider_spec(settings_obj: Dict[str, Any]) -> Optional[ProviderSpec]:
    return get_provider_spec(settings_obj, None)


def create_chat_provider(spec: ProviderSpec) -> ChatProvider:
    t = (spec.provider_type or "").lower().strip()
    if t == "deepseek":
        return DeepSeekChatProvider(spec)
    if t == "openai_codex":
        return OpenAICodexChatProvider(spec)
    openai_like = {
        "openai",
        "openai_compatible",
        "openai-compatible",
        "moonshot",
        "openrouter",
        "zaicoding",
    }
    if t in openai_like:
        if spec.api_format == "anthropic_messages":
            return AnthropicChatProvider(spec)
        return OpenAIChatProvider(spec)
    raise RuntimeError(f"Unsupported provider type: {spec.provider_type}")


class AnthropicChatProvider(OpenAIChatProvider):
    def chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        # Handle Anthropic Messages API
        url = normalize_base_url(self._spec.base_url) + "/messages"
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "anthropic-version": "2023-06-01"}
        if self._spec.api_key:
            headers["x-api-key"] = self._spec.api_key

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        # Convert OpenAI messages to Anthropic format
        system_prompt = None
        anthropic_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content")
            else:
                anthropic_messages.append({"role": msg.get("role"), "content": msg.get("content")})

        payload: Dict[str, Any] = {
            "model": actual_model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens if (max_tokens and max_tokens > 0) else 4096,
            "stream": True,
            "temperature": temperature,
        }

        if system_prompt:
            payload["system"] = system_prompt

        if extra_body:
            payload.update(extra_body)

        # Add tool support if needed (simplified mapping for now)
        if tools:
            payload["tools"] = tools
            if tool_choice:
                payload["tool_choice"] = tool_choice

        data = json.dumps(payload).encode("utf-8")

        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            px = normalize_proxy_url(self._spec.proxy_url)
            handlers.append(urllib.request.ProxyHandler({"http": px, "https": px}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                info = getattr(resp, "headers", None) or resp.info()
                content_type = str((info.get("Content-Type") if info is not None else "") or "").lower()
                if content_type and "text/event-stream" not in content_type:
                    try:
                        raw = resp.read(4096)
                    except Exception:
                        raw = b""
                    body_preview = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
                    body_preview = body_preview.replace("\r\n", "\n").replace("\r", "\n").strip()
                    raise RuntimeError(f"Upstream did not return text/event-stream (contentType={content_type}) bodyPreview={body_preview[:800]}")

                saw_data = False
                first_non_data: str | None = None
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        if first_non_data is None and line:
                            first_non_data = line[:400]
                        continue
                    saw_data = True
                    data_text = line[len("data:") :].strip()
                    if not data_text:
                        continue
                    if data_text == "[DONE]":
                        break
                    try:
                        evt = json.loads(data_text)
                        # Convert Anthropic stream event to OpenAI format
                        if evt.get("type") == "content_block_delta" and "delta" in evt:
                            delta = evt["delta"]
                            if delta.get("type") == "text_delta":
                                yield {"choices": [{"delta": {"content": delta.get("text")}, "finish_reason": None}]}
                        elif evt.get("type") == "message_stop":
                            yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}
                    except Exception:
                        continue
        except Exception as e:
            raise RuntimeError(f"Anthropic stream error: {str(e)}")

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Handle Anthropic Messages API (Non-streaming)
        url = normalize_base_url(self._spec.base_url) + "/messages"
        headers = {"Content-Type": "application/json", "anthropic-version": "2023-06-01"}
        if self._spec.api_key:
            headers["x-api-key"] = self._spec.api_key

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        system_prompt = None
        anthropic_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content")
            else:
                anthropic_messages.append({"role": msg.get("role"), "content": msg.get("content")})

        payload: Dict[str, Any] = {
            "model": actual_model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens if (max_tokens and max_tokens > 0) else 4096,
            "temperature": temperature,
        }
        if system_prompt:
            payload["system"] = system_prompt
        if extra_body:
            payload.update(extra_body)

        data = json.dumps(payload).encode("utf-8")

        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            px = normalize_proxy_url(self._spec.proxy_url)
            handlers.append(urllib.request.ProxyHandler({"http": px, "https": px}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=60) as resp:
                raw = resp.read()
                data = json.loads(raw.decode("utf-8"))
                # Convert to OpenAI format
                content = ""
                for block in data.get("content", []):
                    if block.get("type") == "text":
                        content += block.get("text", "")

                return {
                    "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": data.get("stop_reason")}],
                    "usage": {
                        "prompt_tokens": data.get("usage", {}).get("input_tokens", 0),
                        "completion_tokens": data.get("usage", {}).get("output_tokens", 0),
                    },
                }
        except Exception as e:
            raise RuntimeError(f"Anthropic request error: {str(e)}")


class DeepSeekChatProvider(OpenAIChatProvider):
    def __init__(self, spec: ProviderSpec):
        super().__init__(spec)
        self.include_reasoning_content_in_messages = True

    def chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        url = normalize_base_url(self._spec.base_url) + "/chat/completions"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)
        if self._spec.extra_headers:
            headers.update(self._spec.extra_headers)

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        payload: Dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature, "stream": True}
        if extra_body:
            payload.update(extra_body)
        thinking = payload.get("thinking")
        if isinstance(thinking, dict) and str(thinking.get("type") or "").strip().lower() == "disabled":
            payload.pop("thinking", None)
        elif thinking is None and self._spec.thinking_enabled:
            payload["thinking"] = {"type": "enabled"}
        if max_tokens and max_tokens > 0:
            if self._spec.use_max_completion_tokens:
                payload["max_completion_tokens"] = max_tokens
            else:
                payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice

        data = json.dumps(payload).encode("utf-8")

        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            px = normalize_proxy_url(self._spec.proxy_url)
            handlers.append(urllib.request.ProxyHandler({"http": px, "https": px}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                info = getattr(resp, "headers", None) or resp.info()
                content_type = str((info.get("Content-Type") if info is not None else "") or "").lower()
                if content_type and "text/event-stream" not in content_type:
                    try:
                        raw = resp.read(4096)
                    except Exception:
                        raw = b""
                    body_preview = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
                    body_preview = body_preview.replace("\r\n", "\n").replace("\r", "\n").strip()
                    raise RuntimeError(f"Upstream did not return text/event-stream (contentType={content_type}) bodyPreview={body_preview[:800]}")

                saw_data = False
                first_non_data: str | None = None
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        if first_non_data is None and line:
                            first_non_data = line[:400]
                        continue
                    saw_data = True
                    data_text = line[len("data:") :].strip()
                    if not data_text:
                        continue
                    if data_text == "[DONE]":
                        break
                    try:
                        evt = json.loads(data_text)
                    except Exception:
                        continue
                    if isinstance(evt, dict):
                        yield evt
                if not saw_data:
                    raise RuntimeError(f"Upstream stream produced no SSE data lines (contentType={content_type or 'unknown'}) firstLine={first_non_data or ''}")
        except socket.timeout as e:
            raise RuntimeError("Upstream stream timed out") from e
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"Upstream HTTP {e.code}: {body[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        except Exception as e:
            raise RuntimeError(str(e))

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        model_override: Optional[str] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = normalize_base_url(self._spec.base_url) + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        payload: Dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature}
        if extra_body:
            payload.update(extra_body)
        thinking = payload.get("thinking")
        if isinstance(thinking, dict) and str(thinking.get("type") or "").strip().lower() == "disabled":
            payload.pop("thinking", None)
        elif thinking is None and self._spec.thinking_enabled:
            payload["thinking"] = {"type": "enabled"}
        if max_tokens and max_tokens > 0:
            if self._spec.use_max_completion_tokens:
                payload["max_completion_tokens"] = max_tokens
            else:
                payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice

        data = json.dumps(payload).encode("utf-8")

        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            handlers.append(urllib.request.ProxyHandler({"http": self._spec.proxy_url, "https": self._spec.proxy_url}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=60) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"Upstream HTTP {e.code}: {body[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        except Exception as e:
            raise RuntimeError(str(e))
