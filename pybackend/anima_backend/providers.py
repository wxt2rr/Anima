import json
import re
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
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
    limit = (
        _parse_int(_header_get(headers, "x-ratelimit-limit-tokens"))
        or _parse_int(_header_get(headers, "anthropic-ratelimit-limit-tokens"))
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
            handlers.append(urllib.request.ProxyHandler({"http": self._spec.proxy_url, "https": self._spec.proxy_url}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line or not line.startswith("data:"):
                        continue
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
        endpoint = "/chat/completions"
        if self._spec.api_format == "responses":
            endpoint = "/responses"

        url = normalize_base_url(self._spec.base_url) + endpoint
        headers = {"Content-Type": "application/json"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        payload: Dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature}
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
            handlers.append(urllib.request.ProxyHandler({"http": self._spec.proxy_url, "https": self._spec.proxy_url}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=60) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                raw = resp.read()
                obj = json.loads(raw.decode("utf-8"))
                if isinstance(obj, dict) and self.last_rate_limit:
                    obj["rateLimit"] = self.last_rate_limit
                return obj
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"Upstream HTTP {e.code}: {body[:4000]} | provider={self._spec.provider_id} type={self._spec.provider_type} baseUrl={self._spec.base_url} apiKeyPresent={bool(str(self._spec.api_key or '').strip())}"
            )
        except Exception as e:
            raise RuntimeError(str(e))

def _provider_spec_from_obj(settings_obj: Dict[str, Any], provider_obj: Dict[str, Any]) -> Optional[ProviderSpec]:
    cfg = provider_obj.get("config") or {}
    if not isinstance(cfg, dict):
        return None

    provider_id = str(provider_obj.get("id") or "").strip() or "provider"
    provider_type = str(provider_obj.get("type") or "openai").strip() or "openai"
    base_url = str(cfg.get("baseUrl") or "").strip()
    api_key = str(cfg.get("apiKey") or "").strip()
    model = str(cfg.get("selectedModel") or "").strip()
    if not model:
        models = cfg.get("models") or []
        if isinstance(models, list) and models:
            model = str(models[0] or "").strip()
    proxy_url = str((settings_obj.get("settings") or {}).get("proxyUrl") or "").strip()
    thinking_enabled = bool(cfg.get("thinkingEnabled") is True)
    api_format = str(cfg.get("apiFormat") or "chat_completions").strip()
    use_max_completion_tokens = bool(cfg.get("useMaxCompletionTokens") is True)

    if not base_url:
        return None
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
        headers = {
            "Content-Type": "application/json", 
            "Accept": "text/event-stream",
            "anthropic-version": "2023-06-01"
        }
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
            "temperature": temperature
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
            handlers.append(urllib.request.ProxyHandler({"http": self._spec.proxy_url, "https": self._spec.proxy_url}))
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line or not line.startswith("data:"):
                        continue
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
                                 yield {
                                     "choices": [{
                                         "delta": {"content": delta.get("text")},
                                         "finish_reason": None
                                     }]
                                 }
                        elif evt.get("type") == "message_stop":
                             yield {
                                 "choices": [{
                                     "delta": {},
                                     "finish_reason": "stop"
                                 }]
                             }
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
        headers = {
            "Content-Type": "application/json", 
            "anthropic-version": "2023-06-01"
        }
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
            "temperature": temperature
        }
        if system_prompt:
            payload["system"] = system_prompt
        if extra_body:
            payload.update(extra_body)

        data = json.dumps(payload).encode("utf-8")
        
        handlers: List[urllib.request.BaseHandler] = []
        if self._spec.proxy_url:
            handlers.append(urllib.request.ProxyHandler({"http": self._spec.proxy_url, "https": self._spec.proxy_url}))
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
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": content
                        },
                        "finish_reason": data.get("stop_reason")
                    }],
                    "usage": {
                        "prompt_tokens": data.get("usage", {}).get("input_tokens", 0),
                        "completion_tokens": data.get("usage", {}).get("output_tokens", 0)
                    }
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
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self._spec.api_key:
            headers["Authorization"] = _auth_header_value(self._spec.api_key)

        actual_model = model_override or self._spec.model
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        payload: Dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature, "stream": True}
        if extra_body:
            payload.update(extra_body)
        if self._spec.thinking_enabled:
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
            with opener.open(req, timeout=120) as resp:
                self.last_rate_limit = _extract_rate_limit(getattr(resp, "headers", None) or resp.info())
                for raw_line in resp:
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line or not line.startswith("data:"):
                        continue
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
        if self._spec.thinking_enabled:
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
