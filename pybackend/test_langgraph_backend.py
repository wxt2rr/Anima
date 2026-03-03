import unittest
import uuid
import json
import tempfile
import os
from unittest.mock import patch


class MockProvider:
    include_reasoning_content_in_messages = False

    def __init__(self) -> None:
        self._calls = 0
        self.last_rate_limit = None

    def chat_completion(
        self,
        messages,
        *,
        temperature,
        max_tokens,
        tools=None,
        tool_choice=None,
        model_override=None,
        extra_body=None,
    ):
        self._calls += 1
        if self._calls == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "TodoWrite",
                                        "arguments": '{"todos":[{"id":"t1","content":"x","status":"pending","priority":"low"}],"merge":true}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}


class MockProviderLegacyToolMarkup:
    include_reasoning_content_in_messages = False

    def __init__(self) -> None:
        self._calls = 0
        self.last_rate_limit = None

    def chat_completion(
        self,
        messages,
        *,
        temperature,
        max_tokens,
        tools=None,
        tool_choice=None,
        model_override=None,
        extra_body=None,
    ):
        self._calls += 1
        if self._calls == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": '<tool_call>{"name":"TodoWrite","arguments":{"todos":[{"id":"t1","content":"x","status":"pending","priority":"low"}],"merge":true}}</tool_call>',
                        }
                    }
                ]
            }
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}


class LangGraphBackendIntegrationTests(unittest.TestCase):
    def _make_handler(self, body_obj=None, *, query=None):
        body_bytes = b""
        if body_obj is not None:
            body_bytes = json.dumps(body_obj).encode("utf-8")

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {"Content-Length": str(len(body_bytes))}
                self.wfile = _WFile()
                self.query = query or {}

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                return body_bytes

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        return h

    def _json_out(self, handler):
        raw = handler.wfile.buf.decode("utf-8")
        return json.loads(raw)

    def _with_temp_config_root(self):
        import anima_backend_shared.database as db
        import anima_backend_shared.settings as settings

        td = tempfile.TemporaryDirectory()
        p = td.name
        env = {"ANIMA_CONFIG_ROOT": p}
        return td, env, db, settings

    def test_graph_runs_tools_and_sanitizes_history(self) -> None:
        from anima_backend_lg.runtime.graph import build_run_graph

        provider = MockProvider()
        graph = build_run_graph(provider)

        polluted_tool_message = {"role": "tool", "content": '{"ok": true}', "meta": {"toolTraces": []}}
        init_state = {
            "run_id": "r1",
            "thread_id": "t1",
            "messages": [{"role": "user", "content": "hi"}, polluted_tool_message],
            "composer": {"toolMode": "all"},
            "settings": {"settings": {"defaultToolMode": "all"}},
            "temperature": 0.7,
            "max_tokens": 128,
            "extra_body": None,
            "step": 0,
            "traces": [],
            "usage": None,
            "rate_limit": None,
            "reasoning": "",
            "final_content": "",
        }

        out = graph.invoke(init_state)
        self.assertEqual(str((out or {}).get("final_content") or ""), "ok")

        msgs = (out or {}).get("messages") or []
        self.assertTrue(isinstance(msgs, list))

        tool_call_ids = set()
        for m in msgs:
            if isinstance(m, dict) and m.get("role") == "assistant" and isinstance(m.get("tool_calls"), list):
                for tc in m.get("tool_calls") or []:
                    if isinstance(tc, dict) and isinstance(tc.get("id"), str) and tc.get("id").strip():
                        tool_call_ids.add(tc.get("id").strip())

        for m in msgs:
            if isinstance(m, dict) and m.get("role") == "tool":
                tc_id = m.get("tool_call_id")
                self.assertTrue(isinstance(tc_id, str) and tc_id.strip())
                self.assertIn(tc_id, tool_call_ids)

        traces = (out or {}).get("traces") or []
        self.assertTrue(isinstance(traces, list))
        self.assertTrue(
            any(
                isinstance(t, dict)
                and isinstance((t.get("error") or {}).get("message"), str)
                and "Dropped tool message missing tool_call_id" in (t.get("error") or {}).get("message")
                for t in traces
            )
        )

    def test_system_prompt_includes_tool_guidance_for_telegram_channel(self) -> None:
        from anima_backend_lg.runtime.graph import build_system_prompt_text

        settings_obj = {"settings": {"defaultToolMode": "all"}}
        prompt = build_system_prompt_text(settings_obj, {"channel": "telegram"}, "hi")
        self.assertIn("你是Anima，由小涛创建的AI管家", prompt)
        self.assertIn("工具使用规则", prompt)

        prompt2 = build_system_prompt_text(settings_obj, {}, "hi")
        self.assertIn("你是Anima，由小涛创建的AI管家", prompt2)
        self.assertNotIn("工具使用规则", prompt2)

    def test_telegram_legacy_tool_markup_is_executed(self) -> None:
        from anima_backend_lg.runtime.graph import build_run_graph

        provider = MockProviderLegacyToolMarkup()
        graph = build_run_graph(provider)

        init_state = {
            "run_id": "r1",
            "thread_id": "t1",
            "messages": [{"role": "user", "content": "hi"}],
            "composer": {"toolMode": "all", "channel": "telegram"},
            "settings": {"settings": {"defaultToolMode": "all"}},
            "temperature": 0.7,
            "max_tokens": 128,
            "extra_body": None,
            "step": 0,
            "traces": [],
            "usage": None,
            "rate_limit": None,
            "reasoning": "",
            "final_content": "",
        }

        out = graph.invoke(init_state)
        self.assertEqual(str((out or {}).get("final_content") or ""), "ok")
        traces = (out or {}).get("traces") or []
        self.assertTrue(any(isinstance(t, dict) and t.get("name") == "TodoWrite" and t.get("status") == "succeeded" for t in traces))

    def test_openclaw_prompt_injects_workspace_files_and_bootstraps(self) -> None:
        from anima_backend_lg.runtime.graph import build_system_prompt_text

        with tempfile.TemporaryDirectory() as td:
            settings_obj = {"settings": {"openclaw": {"enabled": True}, "systemPromptMode": "openclaw"}}
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td, "isMainSession": True}, "hi")
            self.assertIn("AGENTS.md", prompt)
            base = os.path.join(td, ".anima")
            self.assertTrue(os.path.isfile(os.path.join(base, "AGENTS.md")))
            self.assertTrue(os.path.isfile(os.path.join(base, "SOUL.md")))
            self.assertTrue(os.path.isfile(os.path.join(base, "USER.md")))
            self.assertTrue(os.path.isfile(os.path.join(base, "TOOLS.md")))
            self.assertTrue(os.path.isfile(os.path.join(base, "IDENTITY.md")))
            self.assertTrue(os.path.isfile(os.path.join(base, "HEARTBEAT.md")))

    def test_openclaw_prompt_does_not_include_memory_md_when_not_main_session(self) -> None:
        from anima_backend_lg.runtime.graph import build_system_prompt_text

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, ".anima"), exist_ok=True)
            with open(os.path.join(td, ".anima", "MEMORY.md"), "w", encoding="utf-8") as f:
                f.write("MEMORY_SECRET_123")
            settings_obj = {"settings": {"openclaw": {"enabled": True}, "systemPromptMode": "openclaw"}}
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td, "isMainSession": False}, "hi")
            self.assertNotIn("MEMORY_SECRET_123", prompt)

    def test_telegram_save_image_to_workspace(self) -> None:
        from anima_backend_lg import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            def _mock_download(_token: str, _file_id: str):
                return {"file_path": "photos/file_1.png", "content": b"pngdata"}

            with patch.object(tg, "_download_telegram_file", side_effect=_mock_download):
                outp = tg._save_telegram_image_to_workspace(
                    token="t",
                    file_id="fid",
                    file_unique_id="uniq",
                    workspace_dir=td,
                )
                self.assertTrue(isinstance(outp, str) and outp)
                self.assertIn("telegram_uploads", str(outp))
                self.assertTrue(str(outp).endswith(".png"))
                self.assertTrue(os.path.isfile(outp))
                with open(outp, "rb") as f:
                    self.assertEqual(f.read(), b"pngdata")

    def test_telegram_extract_image_to_send_from_reply(self) -> None:
        from anima_backend_lg import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            img = os.path.join(td, "out", "a.png")
            with open(img, "wb") as f:
                f.write(b"x")
            picked, caption = tg._extract_image_to_send_from_reply(f"here: {img}", td)
            self.assertEqual(os.path.realpath(str(picked)), os.path.realpath(str(img)))
            self.assertTrue(isinstance(caption, str))
            self.assertNotIn(img, caption)

    def test_default_composer_for_telegram_supports_provider_model_override(self) -> None:
        from anima_backend_lg.telegram_integration import _default_composer_for_telegram

        settings_obj = {
            "settings": {
                "workspaceDir": "/tmp",
                "toolsEnabledIds": [],
                "mcpEnabledServerIds": [],
                "skillsEnabledIds": [],
                "im": {"provider": "telegram", "telegram": {"enabled": True, "providerOverrideId": "p1", "modelOverride": "m1"}},
            }
        }
        composer = _default_composer_for_telegram(settings_obj)
        self.assertEqual(str(composer.get("providerOverrideId") or ""), "p1")
        self.assertEqual(str(composer.get("modelOverride") or ""), "m1")

    def test_telegram_extract_file_from_artifacts(self) -> None:
        from anima_backend_lg import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            fp = os.path.join(td, "out", "a.pdf")
            with open(fp, "wb") as f:
                f.write(b"x")
            picked = tg._extract_file_from_artifacts([{"kind": "file", "path": "out/a.pdf"}], td)
            self.assertEqual(os.path.realpath(str(picked)), os.path.realpath(str(fp)))

    def test_executor_sanitizes_artifacts_and_attaches_to_trace(self) -> None:
        from anima_backend_lg.tools import executor

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            img = os.path.join(td, "out", "a.png")
            with open(img, "wb") as f:
                f.write(b"x")

            def _mock_exec(_name: str, _args: dict, *, workspace_dir: str):
                self.assertEqual(os.path.realpath(workspace_dir), os.path.realpath(td))
                return json.dumps(
                    {
                        "ok": True,
                        "artifacts": [
                            {"kind": "image", "path": "out/a.png", "mime": "image/png"},
                        ],
                    },
                    ensure_ascii=False,
                )

            with patch.object(executor, "execute_builtin_tool", side_effect=_mock_exec):
                _content, trace = executor.execute_tool(
                    "screenshot",
                    {},
                    tool_call_id="tc1",
                    workspace_dir=td,
                    mcp_index={},
                    trace_id="tr1",
                )
                self.assertEqual(trace.get("status"), "succeeded")
                arts = trace.get("artifacts")
                self.assertTrue(isinstance(arts, list) and len(arts) == 1)
                self.assertEqual(os.path.realpath(arts[0].get("path") or ""), os.path.realpath(img))
                self.assertEqual(str(arts[0].get("kind") or ""), "image")

    def test_telegram_extract_image_from_traces(self) -> None:
        from anima_backend_lg import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            img = os.path.join(td, "out", "a.png")
            with open(img, "wb") as f:
                f.write(b"x")
            traces = [
                {
                    "name": "bash",
                    "argsPreview": {"text": json.dumps({"command": f"echo hi && ls {img}"}, ensure_ascii=False), "truncated": False},
                }
            ]
            picked = tg._extract_image_from_traces(traces, td)
            self.assertEqual(os.path.realpath(str(picked)), os.path.realpath(str(img)))

            traces2 = [
                {
                    "name": "screenshot",
                    "resultPreview": {"text": f"截图已完成。已保存到 '{img}' (文件大小: 1.0M)。", "truncated": False},
                }
            ]
            picked2 = tg._extract_image_from_traces(traces2, td)
            self.assertEqual(os.path.realpath(str(picked2)), os.path.realpath(str(img)))

    def test_heartbeat_md_empty_skips_model_call(self) -> None:
        from anima_backend_lg.cron import _execute_job_payload

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, ".anima"), exist_ok=True)
            with open(os.path.join(td, ".anima", "HEARTBEAT.md"), "w", encoding="utf-8") as f:
                f.write("# Heartbeat\n")

            job = {
                "id": "cj_hb",
                "enabled": True,
                "schedule": {"kind": "every", "everyMs": 60000},
                "payload": {
                    "kind": "run",
                    "run": {"composer": {"workspaceDir": td}},
                    "heartbeat": {"ackMaxChars": 300},
                },
            }

            with patch("anima_backend_lg.api.runs.handle_post_runs_non_stream") as mocked:
                ok, out, err = _execute_job_payload(job)
                self.assertTrue(ok)
                self.assertEqual(out, "")
                self.assertIsNone(err)
                mocked.assert_not_called()

    def test_heartbeat_ok_suppresses_telegram_delivery(self) -> None:
        from anima_backend_lg.cron import _execute_job_payload
        import anima_backend_shared.database as db
        import anima_backend_shared.settings as settings

        td = tempfile.TemporaryDirectory()
        env = {"ANIMA_CONFIG_ROOT": td.name}
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings, "_CONFIG_ROOT", None):
                        from anima_backend_shared.database import set_app_settings

                        set_app_settings({"settings": {"im": {"telegram": {"botToken": "t"}}, "workspaceDir": td.name}})

                        job = {
                            "id": "cj_hb2",
                            "enabled": True,
                            "schedule": {"kind": "every", "everyMs": 60000},
                            "payload": {
                                "kind": "run",
                                "run": {"composer": {"workspaceDir": td.name}},
                                "heartbeat": {"ackMaxChars": 300},
                            },
                            "delivery": {"kind": "telegram", "chatId": "123"},
                        }

                        with patch("anima_backend_lg.api.runs.handle_post_runs_non_stream", return_value=(200, {"ok": True, "content": "HEARTBEAT_OK"})):
                            with patch("anima_backend_lg.telegram_integration._tg_send_message") as send_mock:
                                ok, out, err = _execute_job_payload(job)
                                self.assertTrue(ok)
                                self.assertEqual(out.strip(), "HEARTBEAT_OK")
                                self.assertIsNone(err)
                                send_mock.assert_not_called()

    def test_run_resume_stream_emits_done(self) -> None:
        from anima_backend_lg.api.runs import handle_post_run_resume
        from anima_backend_shared.database import create_run, get_run, set_app_settings

        set_app_settings({"settings": {}})

        run_id = f"resume_test_run_{uuid.uuid4().hex}"
        create_run(run_id, "t1", {"messages": [{"role": "user", "content": "hi"}], "composer": {}})
        self.assertTrue(get_run(run_id) is not None)

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()
                self.query = {"stream": "1"}

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                return b'{"messages":[{"role":"user","content":"more"}]}'

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        h.headers = {"Content-Length": str(len(h.rfile_read()))}

        with patch("anima_backend_lg.api.runs.create_provider", return_value=MockProvider()):
            handle_post_run_resume(h, run_id)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "done"', out)

    def test_runs_stream_emits_artifacts_in_trace_and_done(self) -> None:
        from anima_backend_lg.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.calls = 0

            def chat_completion(self, _messages, **_kwargs):
                self.calls += 1
                if self.calls == 1:
                    return {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {
                                            "id": "tc1",
                                            "type": "function",
                                            "function": {"name": "generate_image", "arguments": '{"prompt":"x"}'},
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        def _fake_execute_tool(*_args, **_kwargs):
            tool_content = json.dumps({"ok": True, "artifacts": [{"kind": "image", "path": "out/a.png"}]}, ensure_ascii=False)
            trace = {
                "id": "tr1",
                "toolCallId": "tc1",
                "name": "generate_image",
                "status": "succeeded",
                "artifacts": [
                    {
                        "id": "a1",
                        "kind": "image",
                        "path": "/tmp/a.png",
                        "mime": "image/png",
                        "sizeBytes": 1,
                    }
                ],
            }
            return tool_content, trace

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        with patch("anima_backend_lg.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_lg.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_lg.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_lg.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_lg.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_lg.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                                handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if not line.startswith("data: "):
                    continue
                events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        self.assertTrue(isinstance(done.get("artifacts"), list) and len(done.get("artifacts")) == 1)
        tr_evt = next(
            (
                e
                for e in reversed(events)
                if e.get("type") == "trace"
                and isinstance(e.get("trace"), dict)
                and e["trace"].get("name") == "generate_image"
                and isinstance((e.get("trace") or {}).get("artifacts"), list)
                and len((e.get("trace") or {}).get("artifacts")) == 1
            ),
            None,
        )
        self.assertTrue(isinstance(tr_evt, dict))

    def test_artifacts_file_serves_bytes(self) -> None:
        from anima_backend_lg.api.settings_tools import handle_get_artifact_file

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, ".anima", "artifacts"), exist_ok=True)
            fp = os.path.join(td, ".anima", "artifacts", "a.png")
            with open(fp, "wb") as f:
                f.write(b"xyz")

            from anima_backend_shared.database import set_app_settings

            set_app_settings({"settings": {"workspaceDir": td}})

            class _WFile:
                def __init__(self) -> None:
                    self.buf = b""

                def write(self, b: bytes) -> None:
                    self.buf += b

                def flush(self) -> None:
                    return

            class _Handler:
                def __init__(self) -> None:
                    self.headers = {}
                    self.wfile = _WFile()
                    self.query = {"path": fp, "workspaceDir": td}

                def send_response(self, code) -> None:
                    self._code = int(code)

                def send_header(self, k, v) -> None:
                    return

                def end_headers(self) -> None:
                    return

            h = _Handler()
            handle_get_artifact_file(h)
            self.assertEqual(int(getattr(h, "_code", 0)), 200)
            self.assertEqual(h.wfile.buf, b"xyz")

    def test_attachments_file_serves_abs_image_outside_workspace(self) -> None:
        from anima_backend_lg.api.settings_tools import handle_get_attachment_file

        with tempfile.TemporaryDirectory() as td:
            ws = os.path.join(td, "workspace")
            os.makedirs(ws, exist_ok=True)
            out_dir = os.path.join(td, "out")
            os.makedirs(out_dir, exist_ok=True)
            fp = os.path.join(out_dir, "a.png")
            with open(fp, "wb") as f:
                f.write(b"xyz")

            class _WFile:
                def __init__(self) -> None:
                    self.buf = b""

                def write(self, b: bytes) -> None:
                    self.buf += b

                def flush(self) -> None:
                    return

            class _Handler:
                def __init__(self) -> None:
                    self.headers = {}
                    self.wfile = _WFile()
                    self.query = {"path": fp, "workspaceDir": ws}

                def send_response(self, code) -> None:
                    self._code = int(code)

                def send_header(self, k, v) -> None:
                    return

                def end_headers(self) -> None:
                    return

            h = _Handler()
            handle_get_attachment_file(h)
            self.assertEqual(int(getattr(h, "_code", 0)), 200)
            self.assertEqual(h.wfile.buf, b"xyz")

    def test_chat_prepare_returns_messages(self) -> None:
        from anima_backend_lg.api.runs import handle_post_chat_prepare

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                return b'{"messages":[{"role":"user","content":"hi"}],"composer":{}}'

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        h.headers = {"Content-Length": str(len(h.rfile_read()))}

        handle_post_chat_prepare(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"messages"', out)

    def test_apply_attachments_inline_embeds_image_blocks(self) -> None:
        from anima_backend_shared.chat import apply_attachments_inline

        import base64

        with tempfile.TemporaryDirectory() as td:
            img_path = os.path.join(td, "a.png")
            png = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2wAAAABJRU5ErkJggg=="
            )
            with open(img_path, "wb") as f:
                f.write(png)

            messages = [{"role": "user", "content": "describe"}]
            composer = {"workspaceDir": td, "attachments": [{"path": img_path, "mode": "inline"}]}
            out = apply_attachments_inline(messages, composer)
            self.assertTrue(isinstance(out, list) and len(out) == 1)
            content = out[0].get("content")
            self.assertTrue(isinstance(content, list))
            self.assertTrue(any(isinstance(b, dict) and b.get("type") == "image_url" for b in content))
            img = next((b for b in content if isinstance(b, dict) and b.get("type") == "image_url"), None)
            self.assertTrue(isinstance(img, dict))
            url = ((img.get("image_url") or {}) if isinstance(img.get("image_url"), dict) else {}).get("url")
            self.assertTrue(isinstance(url, str) and url.startswith("data:image/png;base64,"))

    def test_chat_stream_emits_done_and_turn_id(self) -> None:
        from anima_backend_lg.api.runs import handle_post_chat
        from anima_backend_shared.database import set_app_settings

        set_app_settings(
            {
                "settings": {"defaultToolMode": "all"},
                "providers": [
                    {
                        "id": "p1",
                        "type": "openai",
                        "isEnabled": True,
                        "config": {"baseUrl": "http://example.com", "apiKey": "x", "selectedModel": "m"},
                    }
                ],
            }
        )

        turn_id = f"t_{uuid.uuid4().hex}"

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()
                self.query = {"stream": "1"}

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                payload = {
                    "turnId": turn_id,
                    "messages": [{"role": "user", "content": "hi"}],
                    "composer": {"toolMode": "all"},
                }
                import json

                return json.dumps(payload).encode("utf-8")

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        h.headers = {"Content-Length": str(len(h.rfile_read()))}

        with patch("anima_backend_shared.providers.create_chat_provider", return_value=MockProvider()):
            handle_post_chat(h)

        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "done"', out)
        self.assertIn(f'"turnId": "{turn_id}"', out)

    def test_dispatch_chats_crud(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()

                        h_create = self._make_handler({"title": "t1"})
                        self.assertTrue(dispatch(h_create, "POST", "/api/chats"))
                        created = self._json_out(h_create)
                        chat_id = str(created.get("id") or "")
                        self.assertTrue(chat_id)

                        h_list = self._make_handler()
                        self.assertTrue(dispatch(h_list, "GET", "/api/chats"))
                        listed = self._json_out(h_list)
                        self.assertTrue(isinstance(listed, list))

                        h_get = self._make_handler()
                        self.assertTrue(dispatch(h_get, "GET", f"/api/chats/{chat_id}"))
                        got = self._json_out(h_get)
                        self.assertEqual(str(got.get("id") or ""), chat_id)

                        h_msg = self._make_handler({"role": "user", "content": "hi"})
                        self.assertTrue(dispatch(h_msg, "POST", f"/api/chats/{chat_id}/messages"))
                        msg = self._json_out(h_msg)
                        msg_id = str(msg.get("id") or "")
                        self.assertTrue(msg_id)

                        h_msg_patch = self._make_handler({"content": "hello"})
                        self.assertTrue(dispatch(h_msg_patch, "PATCH", f"/api/chats/{chat_id}/messages/{msg_id}"))
                        patched_msg = self._json_out(h_msg_patch)
                        self.assertTrue(bool(patched_msg.get("ok")))

                        h_patch = self._make_handler({"title": "t2"})
                        self.assertTrue(dispatch(h_patch, "PATCH", f"/api/chats/{chat_id}"))
                        patched = self._json_out(h_patch)
                        self.assertTrue(bool(patched.get("ok")))

                        h_del = self._make_handler()
                        self.assertTrue(dispatch(h_del, "DELETE", f"/api/chats/{chat_id}"))
                        deleted = self._json_out(h_del)
                        self.assertTrue(bool(deleted.get("ok")))

    def test_dispatch_settings_tools_skills(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db, set_app_settings

        td, env, db, settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        set_app_settings({"settings": {"defaultToolMode": "all"}, "providers": []})

                        h_get = self._make_handler()
                        self.assertTrue(dispatch(h_get, "GET", "/settings"))
                        out = self._json_out(h_get)
                        self.assertTrue(isinstance(out.get("settings"), dict))

                        h_patch = self._make_handler({"settings": {"defaultToolMode": "none"}})
                        self.assertTrue(dispatch(h_patch, "PATCH", "/settings"))
                        out2 = self._json_out(h_patch)
                        self.assertEqual(((out2.get("settings") or {}).get("defaultToolMode")), "none")

                        with patch.object(settings, "list_skills", return_value=("/tmp", [{"id": "s1", "name": "x"}])):
                            h_skills = self._make_handler()
                            self.assertTrue(dispatch(h_skills, "GET", "/skills/list"))
                            out3 = self._json_out(h_skills)
                            self.assertTrue(bool(out3.get("ok")))
                            self.assertTrue(isinstance(out3.get("skills"), list))

                        with patch.object(settings, "get_skills_content", return_value=[{"id": "s1", "content": "c"}]):
                            h_content = self._make_handler({"ids": ["s1"]})
                            self.assertTrue(dispatch(h_content, "POST", "/skills/content"))
                            out4 = self._json_out(h_content)
                            self.assertTrue(bool(out4.get("ok")))
                            self.assertTrue(isinstance(out4.get("skills"), list))

                        with patch.object(settings, "open_folder", return_value=None):
                            h_open = self._make_handler()
                            self.assertTrue(dispatch(h_open, "POST", "/skills/openDir"))
                            out5 = self._json_out(h_open)
                            self.assertTrue(bool(out5.get("ok")))

                        h_tools = self._make_handler()
                        self.assertTrue(dispatch(h_tools, "GET", "/tools/list"))
                        out6 = self._json_out(h_tools)
                        self.assertTrue(bool(out6.get("ok")))
                        self.assertTrue(isinstance(out6.get("tools"), list))

    def test_dispatch_db_export_import_clear(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db, set_app_settings

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        set_app_settings(
                            {
                                "settings": {
                                    "defaultToolMode": "all",
                                    "im": {"provider": "telegram", "telegram": {"enabled": True, "botToken": "secret", "allowedUserIds": ["1"]}},
                                },
                                "providers": [{"id": "p1", "type": "openai", "isEnabled": True, "config": {"apiKey": "secret"}}],
                            }
                        )

                        h_export = self._make_handler()
                        self.assertTrue(dispatch(h_export, "GET", "/api/db/export"))
                        exported = self._json_out(h_export)
                        self.assertTrue(isinstance(exported.get("appSettings"), dict))
                        providers = (exported.get("appSettings") or {}).get("providers") or []
                        self.assertTrue(isinstance(providers, list))
                        if providers and isinstance(providers[0], dict):
                            cfg = providers[0].get("config") or {}
                            if isinstance(cfg, dict):
                                self.assertEqual(str(cfg.get("apiKey") or ""), "")
                        im = ((exported.get("appSettings") or {}).get("settings") or {}).get("im") or {}
                        if isinstance(im, dict):
                            tg = im.get("telegram") or {}
                            if isinstance(tg, dict):
                                self.assertEqual(str(tg.get("botToken") or ""), "")

                        h_clear = self._make_handler()
                        self.assertTrue(dispatch(h_clear, "POST", "/api/db/clear"))
                        cleared = self._json_out(h_clear)
                        self.assertTrue(bool(cleared.get("ok")))

                        h_empty = self._make_handler()
                        self.assertTrue(dispatch(h_empty, "GET", "/api/db/status"))
                        empty_out = self._json_out(h_empty)
                        self.assertTrue(bool(empty_out.get("empty")))

                        snap = {
                            "version": 4,
                            "exportedAt": 1,
                            "appSettings": {"settings": {}, "providers": []},
                            "chats": [{"id": "c1", "title": "x", "createdAt": 1, "updatedAt": 1, "meta": None, "messages": []}],
                        }
                        h_import = self._make_handler(snap)
                        self.assertTrue(dispatch(h_import, "POST", "/api/db/import"))
                        imported = self._json_out(h_import)
                        self.assertTrue(bool(imported.get("ok")))

                        h_empty2 = self._make_handler()
                        self.assertTrue(dispatch(h_empty2, "GET", "/api/db/status"))
                        empty_out2 = self._json_out(h_empty2)
                        self.assertFalse(bool(empty_out2.get("empty")))

    def test_dispatch_runs_non_stream(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db, set_app_settings

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        set_app_settings({"settings": {"defaultToolMode": "all"}, "providers": []})

                        payload = {"runId": f"r_{uuid.uuid4().hex}", "messages": [{"role": "user", "content": "hi"}], "composer": {}}
                        h = self._make_handler(payload)
                        with patch("anima_backend_lg.api.runs.create_provider", return_value=MockProvider()):
                            self.assertTrue(dispatch(h, "POST", "/api/runs"))
                        out = self._json_out(h)
                        self.assertTrue(bool(out.get("ok")))
                        self.assertEqual(out.get("backendImpl"), "langgraph")

    def test_dispatch_fetch_models(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db, set_app_settings

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        set_app_settings({"settings": {}, "providers": []})
                        h = self._make_handler({"baseUrl": "http://example.com", "apiKey": "x"})
                        with patch("anima_backend_shared.providers.fetch_provider_models", return_value=[{"id": "m1"}]):
                            self.assertTrue(dispatch(h, "POST", "/api/providers/fetch_models"))
                        out = self._json_out(h)
                        self.assertTrue(bool(out.get("ok")))
                        self.assertTrue(isinstance(out.get("models"), list))

    def test_dispatch_cron_jobs_upsert_and_list(self) -> None:
        from anima_backend_lg.api import dispatch
        from anima_backend_shared.database import init_db

        td, env, db, settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings, "_CONFIG_ROOT", None):
                        with patch.object(db, "_DB_INITIALIZED", False):
                            init_db()

                            job = {
                                "name": "j1",
                                "enabled": True,
                                "schedule": {"kind": "every", "everyMs": 1000},
                                "payload": {
                                    "kind": "run",
                                    "run": {"runId": f"r_{uuid.uuid4().hex}", "messages": [{"role": "user", "content": "hi"}]},
                                },
                            }
                            h_upsert = self._make_handler({"action": "upsert", "job": job})
                            self.assertTrue(dispatch(h_upsert, "POST", "/api/cron/jobs"))
                            out = self._json_out(h_upsert)
                            self.assertTrue(bool(out.get("ok")))
                            saved = out.get("job") or {}
                            self.assertTrue(isinstance(saved, dict))
                            jid = str(saved.get("id") or "")
                            self.assertTrue(jid)

                            h_list = self._make_handler()
                            self.assertTrue(dispatch(h_list, "GET", "/api/cron/jobs"))
                            out2 = self._json_out(h_list)
                            self.assertTrue(bool(out2.get("ok")))
                            store = out2.get("store") or {}
                            self.assertTrue(isinstance(store, dict))
                            jobs = store.get("jobs") or []
                            self.assertTrue(isinstance(jobs, list))
                            self.assertTrue(any(isinstance(j, dict) and str(j.get("id") or "") == jid for j in jobs))

    def test_builtin_cron_tools_require_allow_flag(self) -> None:
        from anima_backend_shared.database import init_db, set_app_settings
        from anima_backend_shared.tools import execute_builtin_tool

        td, env, db, settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings, "_CONFIG_ROOT", None):
                        with patch.object(db, "_DB_INITIALIZED", False):
                            init_db()
                            set_app_settings({"settings": {"cron": {"allowAgentManage": False}}, "providers": []})
                            with self.assertRaises(RuntimeError):
                                execute_builtin_tool("cron_list", {}, td.name)

    def test_builtin_cron_tools_upsert_list_delete_run(self) -> None:
        from anima_backend_shared.database import init_db, set_app_settings
        from anima_backend_shared.tools import execute_builtin_tool

        td, env, db, settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings, "_CONFIG_ROOT", None):
                        with patch.object(db, "_DB_INITIALIZED", False):
                            init_db()
                            set_app_settings({"settings": {"cron": {"allowAgentManage": True}}, "providers": []})

                            job = {
                                "name": "j1",
                                "enabled": True,
                                "schedule": {"kind": "every", "everyMs": 1000},
                                "payload": {"kind": "run", "run": {"runId": f"r_{uuid.uuid4().hex}", "messages": [{"role": "user", "content": "hi"}]}},
                            }
                            upserted = json.loads(execute_builtin_tool("cron_upsert", {"job": job}, td.name))
                            self.assertTrue(bool(upserted.get("ok")))
                            saved = upserted.get("job") or {}
                            self.assertTrue(isinstance(saved, dict))
                            jid = str(saved.get("id") or "")
                            self.assertTrue(jid)

                            listed = json.loads(execute_builtin_tool("cron_list", {}, td.name))
                            self.assertTrue(bool(listed.get("ok")))
                            store = listed.get("store") or {}
                            self.assertTrue(isinstance(store, dict))
                            jobs = store.get("jobs") or []
                            self.assertTrue(isinstance(jobs, list))
                            self.assertTrue(any(isinstance(j, dict) and str(j.get("id") or "") == jid for j in jobs))

                            ran = json.loads(execute_builtin_tool("cron_run", {"id": jid}, td.name))
                            self.assertTrue(bool(ran.get("ok")))
                            self.assertTrue(bool(ran.get("ran")))

                            deleted = json.loads(execute_builtin_tool("cron_delete", {"id": jid}, td.name))
                            self.assertTrue(bool(deleted.get("ok")))
                            self.assertTrue(bool(deleted.get("deleted")))

                            listed2 = json.loads(execute_builtin_tool("cron_list", {}, td.name))
                            jobs2 = (listed2.get("store") or {}).get("jobs") or []
                            self.assertFalse(any(isinstance(j, dict) and str(j.get("id") or "") == jid for j in jobs2))

    def test_cron_compute_next_run_cron_every_5_minutes(self) -> None:
        from datetime import datetime, timezone

        from anima_backend_lg import cron

        after_ms = int(datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
        schedule = {"kind": "cron", "expr": "*/5 * * * *", "tz": "UTC"}
        nr = cron._compute_next_run_cron(schedule, after_ms)
        self.assertEqual(nr, after_ms + 5 * 60 * 1000)

    def test_select_tools_hides_cron_tools_when_disabled(self) -> None:
        from anima_backend_lg.tools.executor import select_tools

        tools, _mcp_index, _tool_choice = select_tools({"settings": {"cron": {"allowAgentManage": False}}}, {"toolMode": "all"})
        names = []
        for t in tools:
            if not isinstance(t, dict):
                continue
            fn = t.get("function")
            if not isinstance(fn, dict):
                continue
            n = str(fn.get("name") or "").strip()
            if n:
                names.append(n)
        self.assertNotIn("cron_list", names)
        self.assertNotIn("cron_upsert", names)
        self.assertNotIn("cron_delete", names)
        self.assertNotIn("cron_run", names)

    def test_voice_base_dir_returns_dir(self) -> None:
        from anima_backend_lg.api.voice import handle_get_voice_models_base_dir

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

        import os
        import tempfile

        import anima_backend_shared.settings as settings

        h = _Handler()
        with tempfile.TemporaryDirectory() as d:
            with patch.dict(os.environ, {"ANIMA_CONFIG_ROOT": d}):
                with patch.object(settings, "_CONFIG_ROOT", None):
                    handle_get_voice_models_base_dir(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"dir"', out)

    def test_voice_catalog_uses_handler(self) -> None:
        from anima_backend_lg.api.voice import handle_get_voice_models_catalog

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

        h = _Handler()
        with patch(
            "anima_backend_lg.api.voice.voice_model_catalog",
            return_value=[{"id": "openai/whisper-tiny", "name": "Whisper Tiny", "sizeBytes": 123}],
        ):
            handle_get_voice_models_catalog(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"openai/whisper-tiny"', out)

    def test_voice_download_status_requires_task_id(self) -> None:
        from anima_backend_lg.api.voice import handle_get_voice_models_download_status

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {}
                self.wfile = _WFile()
                self.query = {}

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

        h = _Handler()
        handle_get_voice_models_download_status(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": false', out)
        self.assertIn("taskId is required", out)

    def test_voice_download_and_cancel(self) -> None:
        from anima_backend_lg.api.voice import (
            handle_post_voice_models_download,
            handle_post_voice_models_download_cancel,
        )

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self, body_bytes: bytes) -> None:
                self.headers = {"Content-Length": str(len(body_bytes))}
                self.wfile = _WFile()
                self._body = body_bytes

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                return self._body

        import json

        body = json.dumps({"id": "openai/whisper-tiny"}).encode("utf-8")
        h = _Handler(body)
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()

        with patch("anima_backend_lg.api.voice.voice_model_catalog", return_value=[{"id": "openai/whisper-tiny"}]):
            with patch("anima_backend_lg.api.voice._start_download_task", return_value="task123"):
                handle_post_voice_models_download(h)

        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"taskId": "task123"', out)

        from anima_backend_lg.api import voice as lg_voice

        with lg_voice.voice_download_lock:
            lg_voice.voice_download_tasks["task123"] = {"taskId": "task123"}

        cancel_body = json.dumps({"taskId": "task123"}).encode("utf-8")
        h2 = _Handler(cancel_body)
        h2.rfile = type("rf", (), {"read": lambda _self, n=-1: h2.rfile_read()})()
        handle_post_voice_models_download_cancel(h2)
        out2 = h2.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out2)
        with lg_voice.voice_download_lock:
            self.assertTrue(bool(lg_voice.voice_download_tasks["task123"].get("cancelRequested")))

    def test_voice_transcribe_no_content(self) -> None:
        from anima_backend_lg.api.voice import handle_post_voice_transcribe

        class _WFile:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def flush(self) -> None:
                return

        class _Handler:
            def __init__(self) -> None:
                self.headers = {"Content-Length": "0"}
                self.wfile = _WFile()

            def send_response(self, code) -> None:
                self._code = int(code)

            def send_header(self, k, v) -> None:
                return

            def end_headers(self) -> None:
                return

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: b""})()
        handle_post_voice_transcribe(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": false', out)
        self.assertIn("No content", out)

    def test_telegram_send_message_splits_long_text(self) -> None:
        from anima_backend_lg import telegram_integration as tg

        calls = []

        def _fake_api_call(token, method, payload):
            calls.append((token, method, payload))
            return {"ok": True, "result": {"message_id": 1}}

        with patch.object(tg, "_tg_api_post_form", side_effect=_fake_api_call):
            tg._tg_send_message("token", "chat", "x" * 8000)

        self.assertGreaterEqual(len(calls), 2)
        for _token, _method, payload in calls:
            self.assertEqual(_method, "sendMessage")
            self.assertTrue(isinstance(payload, dict))
            self.assertLessEqual(len(str(payload.get("text") or "")), 3900)

    def test_telegram_transcribe_audio_uses_voice_pipeline(self) -> None:
        from anima_backend_lg import telegram_integration as tg
        from anima_backend_shared import settings as shared_settings
        from anima_backend_shared import voice as shared_voice

        def _fake_load_settings():
            return {"settings": {"voice": {"model": "dummy", "language": "auto", "remoteModels": []}}}

        def _fake_download(_token: str, _file_id: str):
            return {"file_path": "voice.ogg", "content": b"123"}

        def _fake_convert(path: str):
            return path, False

        seen = {}

        def _fake_pipeline(_path: str, generate_kwargs=None):
            seen["generate_kwargs"] = generate_kwargs
            return {"text": "hello"}

        with patch.object(shared_settings, "load_settings", side_effect=_fake_load_settings):
            with patch.object(shared_voice, "_normalize_whisper_model_id", return_value="dummy-model"):
                with patch.object(shared_voice, "_is_remote_model_installed", return_value=True):
                    with patch.object(shared_voice, "_convert_audio_to_wav_if_needed", side_effect=_fake_convert):
                        with patch.object(shared_voice, "get_voice_pipeline", return_value=_fake_pipeline):
                            with patch.object(tg, "_download_telegram_file", side_effect=_fake_download):
                                ok, text = tg._transcribe_telegram_audio(token="t", file_id="f", lang_hint="zh-CN")

        self.assertTrue(ok)
        self.assertEqual(text, "hello")
        self.assertTrue(isinstance(seen.get("generate_kwargs"), dict))
        self.assertEqual(seen["generate_kwargs"].get("task"), "transcribe")
        self.assertEqual(seen["generate_kwargs"].get("language"), "chinese")
        self.assertEqual(seen["generate_kwargs"].get("temperature"), 0.0)
        self.assertEqual(seen["generate_kwargs"].get("num_beams"), 1)

    def test_generate_image_tool_writes_file_and_returns_artifact(self) -> None:
        import base64

        from anima_backend_shared import database as db
        from anima_backend_shared import tools as shared_tools

        td, env, db_mod, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db_mod, "_CONFIG_ROOT", None):
                    with patch.object(db_mod, "_DB_INITIALIZED", False):
                        db.init_db()
                        db.set_app_settings(
                            {
                                "settings": {"defaultToolMode": "all"},
                                "providers": [
                                    {
                                        "id": "p1",
                                        "type": "openai",
                                        "isEnabled": True,
                                        "config": {"baseUrl": "http://example.com", "apiKey": "x", "selectedModel": "img-model"},
                                    }
                                ],
                            }
                        )

                        png_bytes = b"not-a-real-png"
                        fake = {"data": [{"b64_json": base64.b64encode(png_bytes).decode("utf-8")}]}

                        with tempfile.TemporaryDirectory() as wdir:
                            with patch.object(shared_tools, "_http_post_json", return_value=fake):
                                out = shared_tools.execute_builtin_tool("generate_image", {"prompt": "a cat"}, workspace_dir=wdir)

                            obj = json.loads(out)
                            self.assertTrue(obj.get("ok") is True)
                            arts = obj.get("artifacts")
                            self.assertTrue(isinstance(arts, list) and len(arts) == 1)
                            a0 = arts[0]
                            self.assertEqual(str(a0.get("kind")), "image")
                            rel = str(a0.get("path") or "")
                            self.assertTrue(rel)
                            self.assertTrue(os.path.isfile(os.path.join(wdir, rel)))

    def test_generate_video_tool_writes_file_and_returns_artifact(self) -> None:
        import base64

        from anima_backend_shared import database as db
        from anima_backend_shared import tools as shared_tools

        td, env, db_mod, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db_mod, "_CONFIG_ROOT", None):
                    with patch.object(db_mod, "_DB_INITIALIZED", False):
                        db.init_db()
                        db.set_app_settings(
                            {
                                "settings": {"defaultToolMode": "all"},
                                "providers": [
                                    {
                                        "id": "p1",
                                        "type": "openai",
                                        "isEnabled": True,
                                        "config": {"baseUrl": "http://example.com", "apiKey": "x", "selectedModel": "vid-model"},
                                    }
                                ],
                            }
                        )

                        mp4_bytes = b"not-a-real-mp4"
                        fake = {"data": [{"b64_json": base64.b64encode(mp4_bytes).decode("utf-8")}]}

                        with tempfile.TemporaryDirectory() as wdir:
                            with patch.object(shared_tools, "_http_post_json", return_value=fake):
                                out = shared_tools.execute_builtin_tool("generate_video", {"prompt": "a cat"}, workspace_dir=wdir)

                            obj = json.loads(out)
                            self.assertTrue(obj.get("ok") is True)
                            arts = obj.get("artifacts")
                            self.assertTrue(isinstance(arts, list) and len(arts) == 1)
                            a0 = arts[0]
                            self.assertEqual(str(a0.get("kind")), "video")
                            rel = str(a0.get("path") or "")
                            self.assertTrue(rel)
                            self.assertTrue(os.path.isfile(os.path.join(wdir, rel)))
                            self.assertTrue(rel.lower().endswith((".mp4", ".webm", ".mov")))

if __name__ == "__main__":
    unittest.main()
