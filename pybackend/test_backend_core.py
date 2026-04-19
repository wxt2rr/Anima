import unittest
import uuid
import json
import tempfile
import os
import time
from unittest.mock import patch

_TEST_CONFIG_ROOT = tempfile.TemporaryDirectory()
os.environ.setdefault("ANIMA_CONFIG_ROOT", _TEST_CONFIG_ROOT.name)
os.environ.setdefault("ANIMA_SKILLS_DIR", os.path.join(_TEST_CONFIG_ROOT.name, "skills"))


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
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}


class MockProviderListDirToolCall:
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
                                    "function": {"name": "list_dir", "arguments": '{"path":"","maxEntries":5}'},
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
                            "content": '<tool_call>{"name":"list_dir","arguments":{"path":"","maxEntries":5}}</tool_call>',
                        }
                    }
                ]
            }
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}


class BackendCoreIntegrationTests(unittest.TestCase):
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
        env = {"ANIMA_CONFIG_ROOT": p, "ANIMA_SKILLS_DIR": os.path.join(p, "skills")}
        return td, env, db, settings

    def test_system_prompt_includes_tool_guidance_for_telegram_channel(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        settings_obj = {"settings": {"defaultToolMode": "all"}}
        prompt = build_system_prompt_text(settings_obj, {"channel": "telegram"}, "hi")
        self.assertIn("你是Anima", prompt)
        self.assertIn("工具使用规则", prompt)
        self.assertIn("Telegram 输出格式规则", prompt)
        self.assertIn("禁止使用 Markdown 语法", prompt)
        self.assertIn("编辑前必须先读取目标文件的当前完整内容", prompt)
        self.assertIn("遇到 apply_patch 返回 CONFLICT", prompt)

        prompt2 = build_system_prompt_text(settings_obj, {}, "hi")
        self.assertIn("你是Anima", prompt2)
        self.assertNotIn("工具使用规则", prompt2)
        self.assertNotIn("Telegram 输出格式规则", prompt2)

    def test_system_prompt_includes_coder_delegation_block_when_enabled(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        settings_obj = {
            "settings": {
                "coder": {
                    "enabled": True,
                    "name": "Codex Desktop",
                    "backendKind": "codex",
                    "command": "codex",
                    "args": ["exec", "{prompt}"],
                }
            }
        }
        prompt = build_system_prompt_text(settings_obj, {}, "请实现一个接口")
        self.assertIn("Coder委托规则:", prompt)
        self.assertIn("Codex Desktop", prompt)
        self.assertIn("底层: Codex", prompt)
        self.assertIn("Coder CLI:", prompt)
        self.assertIn("command: codex", prompt)
        self.assertIn("同步工具调用", prompt)

    def test_system_prompt_control_plane_layer_priority(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        settings_obj = {
            "settings": {
                "systemHardRules": ["[HARD] 安全规则"],
                "systemProjectRules": ["[PROJECT] 项目规则"],
            }
        }
        prompt = build_system_prompt_text(
            settings_obj,
            {"sessionRules": ["[SESSION] 会话规则"]},
            "请帮我分析",
        )
        hard_idx = prompt.find("[HARD] 安全规则")
        project_idx = prompt.find("[PROJECT] 项目规则")
        session_idx = prompt.find("[SESSION] 会话规则")
        self.assertTrue(hard_idx >= 0 and project_idx > hard_idx and session_idx > project_idx)

    def test_system_prompt_no_longer_injects_workspace_user_memory_file(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        with tempfile.TemporaryDirectory() as td:
            anima_dir = os.path.join(td, ".anima")
            os.makedirs(anima_dir, exist_ok=True)
            mem_file = os.path.join(anima_dir, "user_memory.md")
            with open(mem_file, "w", encoding="utf-8") as f:
                f.write("喜欢咖啡\n讨厌早起")
            settings_obj = {"settings": {"defaultToolMode": "all"}}
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td}, "今天聊啥")
            self.assertNotIn("用户记忆（来自", prompt)
            self.assertNotIn("喜欢咖啡", prompt)
            self.assertNotIn("讨厌早起", prompt)

    def test_system_prompt_injects_runtime_memory_retrieval_block(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        with tempfile.TemporaryDirectory() as td:
            from anima_backend_shared.memory_store import add_memory_item

            add_memory_item(
                workspace_dir=td,
                content="用户喜欢黑咖啡，不加糖",
                memory_type="semantic",
                importance=0.9,
                confidence=0.9,
                source="test",
                run_id="r1",
                user_id="u1",
                evidence=["用户明确说明"],
            )
            settings_obj = {
                "settings": {
                    "memoryEnabled": True,
                    "memoryRetrievalEnabled": True,
                    "memoryAutoQueryEnabled": True,
                    "memoryMaxRetrieveCount": 5,
                    "memorySimilarityThreshold": 0.0,
                }
            }
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td}, "咖啡怎么准备")
            self.assertIn("Runtime memory retrieval", prompt)
            self.assertIn("用户喜欢黑咖啡，不加糖", prompt)

    def test_system_prompt_injects_runtime_memory_graph_related_block(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text
        from anima_backend_shared.memory_store import add_memory_item, link_memory_items

        with tempfile.TemporaryDirectory() as td:
            a = add_memory_item(
                workspace_dir=td,
                content="用户喜欢咖啡",
                memory_type="semantic",
                importance=0.9,
                confidence=0.9,
                source="test",
                run_id="r1",
                user_id="u1",
                evidence=["用户说明"],
            )
            b = add_memory_item(
                workspace_dir=td,
                content="用户常去静安寺附近咖啡店",
                memory_type="episodic",
                importance=0.9,
                confidence=0.9,
                source="test",
                run_id="r1",
                user_id="u1",
                evidence=["会话记录"],
            )
            link_memory_items(
                workspace_dir=td,
                from_id=str(a.get("id") or ""),
                to_id=str(b.get("id") or ""),
                relation="related_to",
            )
            settings_obj = {
                "settings": {
                    "memoryEnabled": True,
                    "memoryRetrievalEnabled": True,
                    "memoryAutoQueryEnabled": True,
                    "memoryGraphEnabled": True,
                    "memoryGraphDefaultHops": 1,
                    "memoryMaxRetrieveCount": 5,
                    "memorySimilarityThreshold": 0.1,
                }
            }
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td}, "喜欢")
            self.assertIn("Runtime memory graph related:", prompt)
            self.assertIn("静安寺附近咖啡店", prompt)

    def test_openclaw_prompt_injects_workspace_files_and_bootstraps(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

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

    def test_openclaw_prompt_does_not_include_memory_md_when_not_main_session(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, ".anima"), exist_ok=True)
            with open(os.path.join(td, ".anima", "MEMORY.md"), "w", encoding="utf-8") as f:
                f.write("MEMORY_SECRET_123")
            settings_obj = {"settings": {"openclaw": {"enabled": True}, "systemPromptMode": "openclaw"}}
            prompt = build_system_prompt_text(settings_obj, {"workspaceDir": td, "isMainSession": False}, "hi")
            self.assertNotIn("MEMORY_SECRET_123", prompt)

    def test_telegram_save_image_to_workspace(self) -> None:
        from anima_backend_core import telegram_integration as tg

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
        from anima_backend_core import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            img = os.path.join(td, "out", "a.png")
            with open(img, "wb") as f:
                f.write(b"x")
            picked, caption = tg._extract_image_to_send_from_reply(f"here: {img}", td)
            self.assertEqual(os.path.realpath(str(picked)), os.path.realpath(str(img)))
            self.assertTrue(isinstance(caption, str))
            self.assertNotIn(img, caption)

    def test_telegram_send_message_supports_reply_to(self) -> None:
        from anima_backend_core import telegram_integration as tg

        calls = []

        def _fake_post_form(_token: str, method: str, params: dict):
            calls.append((method, dict(params)))
            return {"ok": True, "result": {}}

        with patch.object(tg, "_tg_api_post_form", side_effect=_fake_post_form):
            tg._tg_send_message("t", "123", "hello", reply_to_message_id=99)

        self.assertTrue(any(m == "sendMessage" and int(p.get("reply_to_message_id") or 0) == 99 for m, p in calls))

    def test_default_composer_for_telegram_supports_provider_model_override(self) -> None:
        from anima_backend_core.telegram_integration import _default_composer_for_telegram

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

    def test_default_composer_for_telegram_permission_scope_current_computer(self) -> None:
        from anima_backend_core.telegram_integration import _default_composer_for_telegram

        settings_obj = {
            "settings": {
                "workspaceDir": "/tmp/ws",
                "im": {"provider": "telegram", "telegram": {"enabled": True, "permissionScope": "current_computer"}},
            }
        }
        composer = _default_composer_for_telegram(settings_obj)
        self.assertEqual(str(composer.get("permissionMode") or ""), "full_access")
        self.assertEqual(str(composer.get("workspaceDir") or ""), "/tmp/ws")

    def test_default_composer_for_telegram_permission_scope_all_projects(self) -> None:
        from anima_backend_core.telegram_integration import _default_composer_for_telegram

        settings_obj = {
            "settings": {
                "projects": [
                    {"id": "p1", "dir": "/tmp/p1"},
                    {"id": "p2", "dir": "/tmp/p2"},
                ],
                "im": {"provider": "telegram", "telegram": {"enabled": True, "permissionScope": "all_projects"}},
            }
        }
        composer = _default_composer_for_telegram(settings_obj)
        roots = composer.get("workspaceRoots") if isinstance(composer.get("workspaceRoots"), list) else []
        self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
        self.assertTrue("/tmp/p1" in roots and "/tmp/p2" in roots)
        self.assertEqual(str(composer.get("workspaceDir") or ""), "/tmp/p1")

    def test_default_composer_for_telegram_permission_scope_specific_projects_multi(self) -> None:
        from anima_backend_core.telegram_integration import _default_composer_for_telegram

        settings_obj = {
            "settings": {
                "projects": [
                    {"id": "p1", "dir": "/tmp/p1"},
                    {"id": "p2", "dir": "/tmp/p2"},
                    {"id": "p3", "dir": "/tmp/p3"},
                ],
                "im": {
                    "provider": "telegram",
                    "telegram": {"enabled": True, "permissionScope": "specific_projects", "projectIds": ["p2", "p3"]},
                },
            }
        }
        composer = _default_composer_for_telegram(settings_obj)
        roots = composer.get("workspaceRoots") if isinstance(composer.get("workspaceRoots"), list) else []
        self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
        self.assertEqual(roots, ["/tmp/p2", "/tmp/p3"])
        self.assertEqual(str(composer.get("workspaceDir") or ""), "/tmp/p2")

    def test_telegram_parse_command_supports_resuce(self) -> None:
        from anima_backend_core import telegram_integration as tg

        cmd, arg = tg._parse_telegram_command("/resuce abcd-1234")
        self.assertEqual(cmd, "resuce")
        self.assertEqual(arg, "abcd-1234")

    def test_telegram_chat_list_contains_id(self) -> None:
        from anima_backend_core import telegram_integration as tg

        text = tg._format_telegram_chat_list(
            [
                {"id": "c1", "title": "会话A", "updatedAt": 20},
                {"id": "c2", "title": "会话B", "updatedAt": 10},
            ]
        )
        self.assertIn("id: c1", text)
        self.assertIn("id: c2", text)

    def test_telegram_resume_select_supports_id_prefix(self) -> None:
        from anima_backend_core import telegram_integration as tg

        chats = [
            {"id": "a1234567-aaaa", "title": "A"},
            {"id": "b7654321-bbbb", "title": "B"},
        ]
        picked, reason = tg._select_telegram_chat_by_resume_arg(chats, "a123")
        self.assertEqual(reason, "")
        self.assertTrue(isinstance(picked, dict))
        self.assertEqual(str((picked or {}).get("id") or ""), "a1234567-aaaa")

    def test_telegram_parse_numeric_approval_decision(self) -> None:
        from anima_backend_core import telegram_integration as tg

        self.assertEqual(tg._parse_telegram_approval_numeric_decision("1"), "approve_once")
        self.assertEqual(tg._parse_telegram_approval_numeric_decision("2"), "approve_thread")
        self.assertEqual(tg._parse_telegram_approval_numeric_decision("3"), "reject")
        self.assertEqual(tg._parse_telegram_approval_numeric_decision("9"), "")

    def test_telegram_format_approval_prompt_contains_options(self) -> None:
        from anima_backend_core import telegram_integration as tg

        out = tg._format_telegram_approval_prompt({"id": "ap1", "command": "rm -rf ."})
        self.assertIn("审批ID: ap1", out)
        self.assertIn("1 通过一次", out)
        self.assertIn("2 当前对话都通过", out)
        self.assertIn("3 拒绝", out)

    def test_telegram_resume_run_via_http_handler_parses_payload(self) -> None:
        from anima_backend_core import telegram_integration as tg

        def _fake_resume(handler, run_id: str) -> None:
            handler.send_response(200)
            handler.send_header("Content-Type", "application/json")
            handler.end_headers()
            handler.wfile.write(json.dumps({"ok": True, "runId": run_id, "content": "done"}, ensure_ascii=False).encode("utf-8"))

        with patch("anima_backend_core.api.runs.handle_post_run_resume", side_effect=_fake_resume):
            status, payload = tg._resume_run_via_http_handler(
                run_id="r1",
                decision="approve_once",
                approval_id="ap1",
                composer={"channel": "telegram"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(bool(payload.get("ok")), True)
        self.assertEqual(str(payload.get("runId") or ""), "r1")

    def test_telegram_extract_file_from_artifacts(self) -> None:
        from anima_backend_core import telegram_integration as tg

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "out"), exist_ok=True)
            fp = os.path.join(td, "out", "a.pdf")
            with open(fp, "wb") as f:
                f.write(b"x")
            picked = tg._extract_file_from_artifacts([{"kind": "file", "path": "out/a.pdf"}], td)
            self.assertEqual(os.path.realpath(str(picked)), os.path.realpath(str(fp)))

    def test_executor_sanitizes_artifacts_and_attaches_to_trace(self) -> None:
        from anima_backend_core.tools import executor

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
                sandbox = trace.get("sandbox") if isinstance(trace.get("sandbox"), dict) else {}
                self.assertEqual(str(sandbox.get("permissionMode") or ""), "workspace_whitelist")
                self.assertEqual(os.path.realpath(str(sandbox.get("workspaceDir") or "")), os.path.realpath(td))
                self.assertEqual(int(sandbox.get("dangerousCommandApprovalsCount") or 0), 0)
                self.assertEqual(bool(sandbox.get("dangerousCommandAllowForThread")), False)

    def test_executor_trace_sandbox_normalizes_composer_fields(self) -> None:
        from anima_backend_core.tools import executor

        with tempfile.TemporaryDirectory() as td:
            def _mock_exec(_name: str, _args: dict, *, workspace_dir: str):
                self.assertEqual(os.path.realpath(workspace_dir), os.path.realpath(td))
                self.assertEqual(str(_args.get("_animaPermissionMode") or ""), "workspace_whitelist")
                self.assertEqual(_args.get("_animaDangerousCommandApprovals"), ["rm -rf ./tmp"])
                self.assertEqual(bool(_args.get("_animaDangerousCommandAllowForThread")), True)
                return json.dumps({"ok": True}, ensure_ascii=False)

            with patch.object(executor, "execute_builtin_tool", side_effect=_mock_exec):
                _content, trace = executor.execute_tool(
                    "bash",
                    {"command": "echo ok"},
                    tool_call_id="tc1",
                    workspace_dir=td,
                    composer={
                        "permissionMode": "invalid_mode",
                        "workspaceDir": td,
                        "dangerousCommandApprovals": ["rm -rf ./tmp", "RM -RF ./TMP", ""],
                        "dangerousCommandAllowForThread": 1,
                    },
                    mcp_index={},
                    trace_id="tr1",
                )
                sandbox = trace.get("sandbox") if isinstance(trace.get("sandbox"), dict) else {}
                self.assertEqual(str(sandbox.get("permissionMode") or ""), "workspace_whitelist")
                self.assertEqual(os.path.realpath(str(sandbox.get("workspaceDir") or "")), os.path.realpath(td))
                self.assertEqual(int(sandbox.get("dangerousCommandApprovalsCount") or 0), 1)
                self.assertEqual(bool(sandbox.get("dangerousCommandAllowForThread")), True)

    def test_sandbox_policy_normalizes_permission_mode_and_workspace(self) -> None:
        from anima_backend_core.runtime.sandbox_policy import normalize_composer_sandbox_fields

        with tempfile.TemporaryDirectory() as td:
            settings_obj = {"settings": {"workspaceDir": td}}
            composer = normalize_composer_sandbox_fields(
                composer={
                    "permissionMode": "unexpected",
                    "dangerousCommandApprovals": ["  rm  ", "RM", " "],
                    "dangerousCommandAllowForThread": "1",
                },
                settings_obj=settings_obj,
            )
            self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
            self.assertEqual(os.path.realpath(str(composer.get("workspaceDir") or "")), os.path.realpath(td))
            self.assertEqual(composer.get("dangerousCommandApprovals"), ["rm"])
            self.assertEqual(bool(composer.get("dangerousCommandAllowForThread")), True)

    def test_telegram_extract_image_from_traces(self) -> None:
        from anima_backend_core import telegram_integration as tg

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

    def test_run_resume_stream_emits_done(self) -> None:
        from anima_backend_core.api.runs import handle_post_run_resume
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

        with patch("anima_backend_core.api.runs.create_provider", return_value=MockProvider()):
            handle_post_run_resume(h, run_id)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "done"', out)
        self.assertIn('"stopReason": "completed"', out)
        self.assertIn('"verification"', out)

    def test_runs_stream_dangerous_command_emits_approval_and_pauses_run(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def chat_completion(self, _messages, **_kwargs):
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
                                        "function": {"name": "bash", "arguments": '{"command":"ls -la"}'},
                                    }
                                ],
                            }
                        }
                    ]
                }

        def _fake_execute_tool(*_args, **_kwargs):
            payload = {
                "code": "dangerous_command_requires_approval",
                "command": "ls -la",
                "matchedPattern": "ls",
            }
            trace = {
                "id": "tr1",
                "toolCallId": "tc1",
                "name": "bash",
                "status": "failed",
                "startedAt": 0,
                "endedAt": 1,
                "durationMs": 1,
                "error": {"message": "ANIMA_DANGEROUS_COMMAND_APPROVAL:" + json.dumps(payload, ensure_ascii=False)},
            }
            return json.dumps({"ok": False, "error": trace["error"]["message"]}, ensure_ascii=False), trace

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                            with patch("anima_backend_core.api.runs_stream.update_run") as p_update:
                                handle_post_runs_stream(h, body)
                                self.assertTrue(any(len(c.args) >= 2 and c.args[1] == "paused" for c in p_update.call_args_list))

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if not line.startswith("data: "):
                    continue
                events.append(json.loads(line[len("data: ") :]))
        approval_evt = next((e for e in events if e.get("type") == "approval_required"), None)
        self.assertTrue(isinstance(approval_evt, dict))
        self.assertEqual(str(((approval_evt or {}).get("approval") or {}).get("command") or ""), "ls -la")
        bash_trace_evt = next(
            (
                e
                for e in events
                if e.get("type") == "trace"
                and isinstance(e.get("trace"), dict)
                and str((e.get("trace") or {}).get("name") or "") == "bash"
            ),
            None,
        )
        self.assertTrue(isinstance(bash_trace_evt, dict))

    def test_run_resume_stream_from_paused_run_completes_same_run(self) -> None:
        from anima_backend_core.api.runs import handle_post_run_resume
        from anima_backend_shared.database import create_run, get_run, set_app_settings, update_run

        set_app_settings({"settings": {}})
        run_id = f"resume_paused_run_{uuid.uuid4().hex}"
        create_run(run_id, "t1", {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}})
        update_run(
            run_id,
            "paused",
            {
                "pauseContext": {
                    "approvalId": "ap1",
                    "approval": {"code": "dangerous_command_requires_approval", "command": "ls -la", "matchedPattern": "ls"},
                    "pendingToolCall": {"id": "tc1", "name": "bash", "args": {"command": "ls -la"}},
                    "messages": [
                        {"role": "user", "content": "hi"},
                        {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{"id": "tc1", "type": "function", "function": {"name": "bash", "arguments": '{"command":"ls -la"}'}}],
                        },
                    ],
                    "traces": [],
                    "artifacts": [],
                    "composer": {"workspaceDir": "/tmp"},
                    "temperature": 0.7,
                    "maxTokens": 128,
                }
            },
        )

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
                return b'{"approvalId":"ap1","decision":"approve_once"}'

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        h.headers = {"Content-Length": str(len(h.rfile_read()))}

        trace = {
            "id": "tr_resume_1",
            "toolCallId": "tc1",
            "name": "bash",
            "status": "succeeded",
            "startedAt": 0,
            "endedAt": 1,
            "durationMs": 1,
        }
        out_payload = {
            "paused": False,
            "final_content": "done",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "done"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "tool_receipt", "tool": "bash", "summary": "ok"}]},
        }
        worker_ctx = {
            "reportsText": "",
            "traces": [],
            "artifacts": [],
            "verification": {"status": "passed", "evidence": [{"type": "worker_report", "summary": "workers=1 failed=0"}]},
            "orchestration": {"workers": 1, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
        }

        with patch("anima_backend_core.api.runs.create_provider", return_value=MockProvider()):
            with patch("anima_backend_core.api.runs.execute_tool", return_value=(json.dumps({"ok": True}, ensure_ascii=False), trace)):
                with patch("anima_backend_core.api.runs._run_coordinator_workers", return_value=worker_ctx):
                    with patch("anima_backend_core.api.runs._run_tool_loop", return_value=out_payload):
                        handle_post_run_resume(h, run_id)

        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "done"', out)
        self.assertIn('"orchestration"', out)
        run = get_run(run_id)
        self.assertTrue(isinstance(run, dict))
        self.assertEqual(str((run or {}).get("status") or ""), "succeeded")

    def test_run_resume_stream_reject_still_emits_aggregated_done(self) -> None:
        from anima_backend_core.api.runs import handle_post_run_resume
        from anima_backend_shared.database import create_run, get_run, set_app_settings, update_run

        set_app_settings({"settings": {}})
        run_id = f"resume_reject_run_{uuid.uuid4().hex}"
        create_run(run_id, "t1", {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}})
        update_run(
            run_id,
            "paused",
            {
                "pauseContext": {
                    "approvalId": "ap1",
                    "approval": {"code": "dangerous_command_requires_approval", "command": "ls -la", "matchedPattern": "ls"},
                    "pendingToolCall": {"id": "tc1", "name": "bash", "args": {"command": "ls -la"}},
                    "messages": [
                        {"role": "user", "content": "hi"},
                        {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{"id": "tc1", "type": "function", "function": {"name": "bash", "arguments": '{"command":"ls -la"}'}}],
                        },
                    ],
                    "traces": [],
                    "artifacts": [],
                    "composer": {"workspaceDir": "/tmp"},
                    "temperature": 0.7,
                    "maxTokens": 128,
                }
            },
        )

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

            def send_header(self, _k, _v) -> None:
                return

            def end_headers(self) -> None:
                return

            def rfile_read(self) -> bytes:
                return b'{"approvalId":"ap1","decision":"reject"}'

        h = _Handler()
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h.rfile_read()})()
        h.headers = {"Content-Length": str(len(h.rfile_read()))}

        out_payload = {
            "paused": False,
            "final_content": "done",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "done"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "tool_receipt", "tool": "bash", "summary": "ok"}]},
        }
        worker_ctx = {
            "reportsText": "",
            "traces": [],
            "artifacts": [],
            "verification": {"status": "passed", "evidence": [{"type": "worker_report", "summary": "workers=0 failed=0"}]},
            "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
        }

        with patch("anima_backend_core.api.runs.create_provider", return_value=MockProvider()):
            with patch("anima_backend_core.api.runs._run_coordinator_workers", return_value=worker_ctx):
                with patch("anima_backend_core.api.runs._run_tool_loop", return_value=out_payload):
                    handle_post_run_resume(h, run_id)

        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "done"', out)
        self.assertIn('"orchestration"', out)
        self.assertIn('"status": "succeeded"', out)
        run = get_run(run_id)
        self.assertTrue(isinstance(run, dict))
        self.assertEqual(str((run or {}).get("status") or ""), "succeeded")

    def test_runs_stream_emits_artifacts_in_trace_and_done(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

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
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
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

    def test_runs_stream_done_contains_verification_and_stop_reason(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

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
                                            "function": {"name": "bash", "arguments": '{"command":"echo ok"}'},
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                return {"choices": [{"message": {"role": "assistant", "content": "done"}}]}

        def _fake_execute_tool(*_args, **_kwargs):
            return (
                json.dumps({"ok": True, "stdout": "ok\n"}, ensure_ascii=False),
                {
                    "id": "tr1",
                    "toolCallId": "tc1",
                    "name": "bash",
                    "status": "succeeded",
                    "startedAt": 1,
                    "endedAt": 2,
                    "durationMs": 1,
                    "resultPreview": {"kind": "text", "text": "ok", "truncated": False},
                },
            )

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "run"}], "composer": {"workspaceDir": "/tmp", "verificationRequired": True}}
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                                handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        self.assertEqual(str((done or {}).get("stopReason") or ""), "completed")
        self.assertTrue(isinstance((done or {}).get("verification"), dict))
        self.assertEqual(str(((done or {}).get("verification") or {}).get("status") or ""), "passed")

    def test_runs_stream_openai_codex_keeps_tools_enabled(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.calls = 0
                self._spec = type("Spec", (), {"provider_type": "openai_codex"})()

            def chat_completion_stream(self, _messages, **kwargs):
                self.calls += 1
                tools = kwargs.get("tools")
                if self.calls == 1:
                    if not tools:
                        yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}
                        return
                    yield {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "tc1",
                                            "type": "function",
                                            "function": {"name": "list_dir", "arguments": '{"path":"","maxEntries":5}'},
                                        }
                                    ]
                                },
                                "finish_reason": None,
                            }
                        ]
                    }
                    yield {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}
                    return
                yield {"choices": [{"delta": {"content": "ok"}, "finish_reason": None}]}
                yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

        def _fake_execute_tool(*_args, **_kwargs):
            return json.dumps({"ok": True, "entries": ["a"]}, ensure_ascii=False), {
                "id": "tr1",
                "toolCallId": "tc1",
                "name": "list_dir",
                "status": "succeeded",
                "startedAt": 1,
                "endedAt": 2,
                "durationMs": 1,
            }

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch(
                    "anima_backend_core.api.runs_stream.select_tools",
                    return_value=(
                        [
                            {
                                "type": "function",
                                "function": {
                                    "name": "list_dir",
                                    "description": "列目录",
                                    "parameters": {"type": "object"},
                                },
                            }
                        ],
                        {},
                        None,
                    ),
                ):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                                handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        self.assertIn('"stage": "tools"', raw)
        self.assertIn('"content": "ok"', raw)

    def test_runs_stream_empty_model_response_emits_error(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def chat_completion_stream(self, _messages, **_kwargs):
                yield {"type": "response.completed", "choices": [{"delta": {}, "finish_reason": "stop"}]}

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        self.assertIn('"type": "error"', raw)
        self.assertIn('Model returned no text and no tool calls', raw)

    def test_openai_codex_stream_empty_with_events_reports_preview(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def __init__(self) -> None:
                self._lines = [
                    b"HTTP/1.1 200 OK\r\n",
                    b"Content-Type: text/event-stream\r\n",
                    b"\r\n",
                    b'data: {"type":"response.completed","response":{"status":"completed"}}\n',
                    b"\n",
                ]
                self._i = 0

            def readline(self) -> bytes:
                if self._i >= len(self._lines):
                    return b""
                line = self._lines[self._i]
                self._i += 1
                return line

            def read(self, _n: int = -1) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def poll(self):
                return 0

            def wait(self, timeout=None) -> int:
                return 0

        import anima_backend_shared.providers as prov_mod

        def _select(_r, _w, _e, _t):
            return (_r, _w, _e)

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(prov_mod.select, "select", side_effect=_select):
                    with self.assertRaises(RuntimeError) as ctx:
                        list(
                            p.chat_completion_stream(
                                [{"role": "user", "content": "hi"}],
                                temperature=0.2,
                                max_tokens=16,
                            )
                        )
        self.assertIn("Model returned no text and no tool calls", str(ctx.exception))
        self.assertIn("Upstream events:", str(ctx.exception))
        self.assertIn("response.completed", str(ctx.exception))

    def test_runs_stream_verification_required_without_evidence_stops_as_failed(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        h = self._make_handler()
        body = {
            "messages": [{"role": "user", "content": "直接回答"}],
            "composer": {"workspaceDir": "/tmp", "verificationRequired": True},
        }
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=MockProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        self.assertEqual(str((done or {}).get("stopReason") or ""), "verification_failed")
        self.assertEqual(str(((done or {}).get("verification") or {}).get("status") or ""), "unverified")

    def test_runs_stream_stream_fallback_emits_recovery_trace(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None

            def chat_completion_stream(self, _messages, **_kwargs):
                raise RuntimeError("stream channel broken")

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        h = self._make_handler()
        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        recovery = next(
            (
                e
                for e in events
                if e.get("type") == "trace"
                and isinstance(e.get("trace"), dict)
                and str((e.get("trace") or {}).get("name") or "") == "recovery/model_fallback"
            ),
            None,
        )
        self.assertTrue(isinstance(recovery, dict))

    def test_runs_stream_worker_role_isolates_history_context(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.seen_messages = []

            def chat_completion(self, messages, **_kwargs):
                self.seen_messages.append(messages)
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        h = self._make_handler()
        body = {
            "threadId": "worker_t1",
            "useThreadMessages": True,
            "messages": [{"role": "user", "content": "latest user task"}],
            "composer": {"workspaceDir": "/tmp", "agentRole": "worker"},
        }
        history = [
            {"role": "user", "content": "old user 1"},
            {"role": "assistant", "content": "old assistant 1"},
            {"role": "user", "content": "old user 2"},
        ]

        p = _FakeProvider()
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {"enableAutoCompression": False}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=p):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.get_chat", return_value={"messages": history}):
                                handle_post_runs_stream(h, body)

        self.assertTrue(len(p.seen_messages) >= 1)
        first = p.seen_messages[0]
        user_contents = [str(m.get("content") or "") for m in first if isinstance(m, dict) and str(m.get("role") or "") == "user"]
        self.assertEqual(user_contents, ["latest user task"])

    def test_runs_stream_coordinator_merges_worker_outputs(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "main ok"}}]}

        worker_out = {
            "paused": False,
            "final_content": "worker ok",
            "usage": None,
            "traces": [
                {
                    "id": "wtr1",
                    "toolCallId": "wtc1",
                    "name": "bash",
                    "status": "succeeded",
                    "resultPreview": {"kind": "text", "text": "worker done", "truncated": False},
                }
            ],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "worker ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "tool_receipt", "tool": "bash", "summary": "worker done"}]},
        }
        main_out = {
            "paused": False,
            "final_content": "main ok",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "main ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "skipped", "summary": "verification not required"}]},
        }

        h = self._make_handler()
        body = {
            "messages": [{"role": "user", "content": "coordinator task"}],
            "composer": {"workspaceDir": "/tmp"},
        }
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch(
                                "anima_backend_core.api.runs_stream._plan_worker_execution",
                                return_value={"tasks": [{"index": 1, "prompt": "sub task 1", "modelOverride": "", "timeoutMs": 0}], "parallelism": 1, "retryMax": 1, "timeoutMs": 0},
                            ):
                                with patch("anima_backend_core.api.runs_stream._run_tool_loop", side_effect=[worker_out, main_out]):
                                    handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        traces = (done or {}).get("traces")
        self.assertTrue(isinstance(traces, list))
        self.assertTrue(any(isinstance(t, dict) and str(t.get("name") or "") == "bash" for t in (traces or [])))
        verification = (done or {}).get("verification")
        self.assertTrue(isinstance(verification, dict))
        self.assertEqual(str((verification or {}).get("status") or ""), "passed")
        ev = (verification or {}).get("evidence")
        self.assertTrue(isinstance(ev, list) and any(isinstance(x, dict) and str(x.get("type") or "") == "worker_report" for x in ev))
        orchestration = (done or {}).get("orchestration")
        self.assertTrue(isinstance(orchestration, dict))
        self.assertEqual(int((orchestration or {}).get("workers") or 0), 1)

    def test_runs_stream_coordinator_worker_retry_records_stats(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "main ok"}}]}

        worker_fail = {
            "paused": False,
            "final_content": "worker failed",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "worker failed"}],
            "rate_limit": None,
            "stop_reason": "verification_failed",
            "verification": {"status": "failed", "evidence": [{"type": "tool_failure", "tool": "bash", "summary": "x"}]},
        }
        worker_pass = {
            "paused": False,
            "final_content": "worker ok",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "worker ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "tool_receipt", "tool": "bash", "summary": "ok"}]},
        }
        main_out = {
            "paused": False,
            "final_content": "main ok",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "main ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": [{"type": "skipped", "summary": "verification not required"}]},
        }

        h = self._make_handler()
        body = {
            "messages": [{"role": "user", "content": "coordinator task"}],
            "composer": {
                "workspaceDir": "/tmp",
            },
        }
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch(
                                "anima_backend_core.api.runs_stream._plan_worker_execution",
                                return_value={"tasks": [{"index": 1, "prompt": "sub task retry", "modelOverride": "", "timeoutMs": 0}], "parallelism": 1, "retryMax": 1, "timeoutMs": 0},
                            ):
                                with patch("anima_backend_core.api.runs_stream._run_tool_loop", side_effect=[worker_fail, worker_pass, main_out]):
                                    handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        orchestration = (done or {}).get("orchestration")
        self.assertTrue(isinstance(orchestration, dict))
        self.assertEqual(int((orchestration or {}).get("totalRetries") or 0), 1)
        reasons = (orchestration or {}).get("failureReasons")
        self.assertTrue(isinstance(reasons, dict))
        self.assertEqual(int((reasons or {}).get("verification_failed") or 0), 1)

    def test_runs_stream_coordinator_worker_timeout_records_reason(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "main ok"}}]}

        def _fake_run_tool_loop(*_args, **kwargs):
            composer = kwargs.get("composer") if isinstance(kwargs, dict) else None
            role = str((composer or {}).get("agentRole") or "")
            if role == "worker":
                time.sleep(0.05)
                return {
                    "paused": False,
                    "final_content": "worker late",
                    "usage": None,
                    "traces": [],
                    "artifacts": [],
                    "reasoning": "",
                    "messages": [{"role": "assistant", "content": "late"}],
                    "rate_limit": None,
                    "stop_reason": "completed",
                    "verification": {"status": "passed", "evidence": []},
                }
            return {
                "paused": False,
                "final_content": "main ok",
                "usage": None,
                "traces": [],
                "artifacts": [],
                "reasoning": "",
                "messages": [{"role": "assistant", "content": "main ok"}],
                "rate_limit": None,
                "stop_reason": "completed",
                "verification": {"status": "passed", "evidence": []},
            }

        h = self._make_handler()
        body = {
            "messages": [{"role": "user", "content": "coordinator timeout task"}],
            "composer": {
                "workspaceDir": "/tmp",
            },
        }
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch(
                                "anima_backend_core.api.runs_stream._plan_worker_execution",
                                return_value={"tasks": [{"index": 1, "prompt": "sub timeout", "modelOverride": "", "timeoutMs": 5}], "parallelism": 1, "retryMax": 0, "timeoutMs": 5},
                            ):
                                with patch("anima_backend_core.api.runs_stream._run_tool_loop", side_effect=_fake_run_tool_loop):
                                    handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: ") :]))
        done = next((e for e in events if e.get("type") == "done"), None)
        self.assertTrue(isinstance(done, dict))
        self.assertEqual(str((done or {}).get("stopReason") or ""), "verification_failed")
        orchestration = (done or {}).get("orchestration")
        self.assertTrue(isinstance(orchestration, dict))
        self.assertEqual(int((orchestration or {}).get("failedWorkers") or 0), 1)
        reasons = (orchestration or {}).get("failureReasons")
        self.assertTrue(isinstance(reasons, dict))
        self.assertTrue(int((reasons or {}).get("timeout") or 0) >= 1)

    def test_runs_stream_worker_task_model_override(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        seen_model_overrides = []

        def _fake_create_provider(_settings_obj, composer):
            seen_model_overrides.append(str((composer or {}).get("modelOverride") or ""))
            return _FakeProvider()

        worker_out = {
            "paused": False,
            "final_content": "worker ok",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "worker ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": []},
        }
        main_out = {
            "paused": False,
            "final_content": "main ok",
            "usage": None,
            "traces": [],
            "artifacts": [],
            "reasoning": "",
            "messages": [{"role": "assistant", "content": "main ok"}],
            "rate_limit": None,
            "stop_reason": "completed",
            "verification": {"status": "passed", "evidence": []},
        }

        h = self._make_handler()
        body = {
            "messages": [{"role": "user", "content": "coordinator model override"}],
            "composer": {
                "workspaceDir": "/tmp",
            },
        }
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", side_effect=_fake_create_provider):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch(
                                "anima_backend_core.api.runs_stream._plan_worker_execution",
                                return_value={"tasks": [{"index": 1, "prompt": "sub model task", "modelOverride": "worker-model-x", "timeoutMs": 0}], "parallelism": 1, "retryMax": 1, "timeoutMs": 0},
                            ):
                                with patch("anima_backend_core.api.runs_stream._run_tool_loop", side_effect=[worker_out, main_out]):
                                    handle_post_runs_stream(h, body)

        self.assertTrue(any(x == "worker-model-x" for x in seen_model_overrides))

    def test_run_tool_loop_blocks_repeated_apply_patch_after_conflict_until_read_file(self) -> None:
        from anima_backend_core.api.runs_stream import _run_tool_loop

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None
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
                                            "id": "call_1",
                                            "type": "function",
                                            "function": {
                                                "name": "apply_patch",
                                                "arguments": json.dumps(
                                                    {
                                                        "patch": "*** Begin Patch\n*** Update File: src/options/OptionsApp.vue\n@@\n-old\n+new\n*** End Patch"
                                                    }
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                if self.calls == 2:
                    return {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {
                                            "id": "call_2",
                                            "type": "function",
                                            "function": {
                                                "name": "apply_patch",
                                                "arguments": json.dumps(
                                                    {
                                                        "patch": "*** Begin Patch\n*** Update File: src/options/OptionsApp.vue\n@@\n-old2\n+new2\n*** End Patch"
                                                    }
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                return {"choices": [{"message": {"role": "assistant", "content": "done"}}]}

        executed = []

        def _fake_execute_tool(tool_name, args, **kwargs):
            executed.append({"tool_name": tool_name, "args": args, "kwargs": kwargs})
            return (
                json.dumps({"ok": False, "error": "CONFLICT: source block occurrences 0 != 1"}),
                {
                    "id": "tr_fake_apply",
                    "toolCallId": str(kwargs.get("tool_call_id") or ""),
                    "name": tool_name,
                    "status": "failed",
                    "startedAt": 1,
                    "endedAt": 2,
                    "durationMs": 1,
                    "error": {"message": "CONFLICT: source block occurrences 0 != 1"},
                    "resultPreview": {"text": '{"ok":false,"error":"CONFLICT: source block occurrences 0 != 1"}', "truncated": False},
                },
            )

        with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
            with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                out = _run_tool_loop(
                    provider=_FakeProvider(),
                    prepared=[{"role": "user", "content": "edit file"}],
                    composer={"workspaceDir": "/tmp/workspace"},
                    settings_obj={"settings": {}},
                    temperature=0.2,
                    max_tokens=64,
                    extra_body=None,
                )

        self.assertEqual(len(executed), 1)
        traces = out.get("traces") or []
        self.assertGreaterEqual(len(traces), 2)
        self.assertEqual(str((traces[0] or {}).get("status") or ""), "failed")
        self.assertIn("CONFLICT", str((((traces[0] or {}).get("error") or {}).get("message") or "")))
        self.assertEqual(str((traces[1] or {}).get("status") or ""), "failed")
        self.assertIn("read_file", str((((traces[1] or {}).get("error") or {}).get("message") or "")))

    def test_run_tool_loop_allows_apply_patch_after_successful_read_file(self) -> None:
        from anima_backend_core.api.runs_stream import _run_tool_loop

        class _FakeProvider:
            def __init__(self) -> None:
                self.last_rate_limit = None
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
                                            "id": "call_1",
                                            "type": "function",
                                            "function": {
                                                "name": "apply_patch",
                                                "arguments": json.dumps(
                                                    {
                                                        "patch": "*** Begin Patch\n*** Update File: src/options/OptionsApp.vue\n@@\n-old\n+new\n*** End Patch"
                                                    }
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                if self.calls == 2:
                    return {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {
                                            "id": "call_2",
                                            "type": "function",
                                            "function": {
                                                "name": "read_file",
                                                "arguments": json.dumps({"path": "src/options/OptionsApp.vue"}),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                if self.calls == 3:
                    return {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {
                                            "id": "call_3",
                                            "type": "function",
                                            "function": {
                                                "name": "apply_patch",
                                                "arguments": json.dumps(
                                                    {
                                                        "patch": "*** Begin Patch\n*** Update File: src/options/OptionsApp.vue\n@@\n-old2\n+new2\n*** End Patch"
                                                    }
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                return {"choices": [{"message": {"role": "assistant", "content": "done"}}]}

        executed = []

        def _fake_execute_tool(tool_name, args, **kwargs):
            executed.append(tool_name)
            if tool_name == "read_file":
                return (
                    json.dumps({"meta": {"path": "/tmp/workspace/src/options/OptionsApp.vue", "truncated": False}, "text": "content"}, ensure_ascii=False),
                    {
                        "id": "tr_fake_read",
                        "toolCallId": str(kwargs.get("tool_call_id") or ""),
                        "name": tool_name,
                        "status": "succeeded",
                        "startedAt": 3,
                        "endedAt": 4,
                        "durationMs": 1,
                        "resultPreview": {"text": "ok", "truncated": False},
                    },
                )
            if tool_name == "apply_patch" and executed.count("apply_patch") == 1:
                return (
                    json.dumps({"ok": False, "error": "CONFLICT: source block occurrences 0 != 1"}),
                    {
                        "id": "tr_fake_apply_1",
                        "toolCallId": str(kwargs.get("tool_call_id") or ""),
                        "name": tool_name,
                        "status": "failed",
                        "startedAt": 1,
                        "endedAt": 2,
                        "durationMs": 1,
                        "error": {"message": "CONFLICT: source block occurrences 0 != 1"},
                        "resultPreview": {"text": '{"ok":false,"error":"CONFLICT: source block occurrences 0 != 1"}', "truncated": False},
                    },
                )
            return (
                json.dumps({"ok": True}, ensure_ascii=False),
                {
                    "id": "tr_fake_apply_2",
                    "toolCallId": str(kwargs.get("tool_call_id") or ""),
                    "name": tool_name,
                    "status": "succeeded",
                    "startedAt": 5,
                    "endedAt": 6,
                    "durationMs": 1,
                    "resultPreview": {"text": '{"ok":true}', "truncated": False},
                },
            )

        with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
            with patch("anima_backend_core.api.runs_stream.execute_tool", side_effect=_fake_execute_tool):
                out = _run_tool_loop(
                    provider=_FakeProvider(),
                    prepared=[{"role": "user", "content": "edit file"}],
                    composer={"workspaceDir": "/tmp/workspace"},
                    settings_obj={"settings": {}},
                    temperature=0.2,
                    max_tokens=64,
                    extra_body=None,
                )

        self.assertEqual(executed, ["apply_patch", "read_file", "apply_patch"])
        traces = out.get("traces") or []
        self.assertEqual(str((traces[0] or {}).get("status") or ""), "failed")
        self.assertEqual(str((traces[1] or {}).get("status") or ""), "succeeded")
        self.assertEqual(str((traces[2] or {}).get("status") or ""), "succeeded")

    def test_runs_stream_returns_json_error_when_provider_not_configured(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        body = {"messages": [{"role": "user", "content": "hi"}], "composer": {"workspaceDir": "/tmp"}}
        h = self._make_handler(body)
        with patch("anima_backend_core.api.runs_stream.load_settings", return_value={"settings": {}}):
            with patch("anima_backend_core.api.runs_stream.create_provider", side_effect=RuntimeError("No provider configured. Please configure a provider in Settings.")):
                handle_post_runs_stream(h, body)

        self.assertEqual(getattr(h, "_code", 0), 400)
        out = self._json_out(h)
        self.assertFalse(bool(out.get("ok")))
        self.assertEqual(str(out.get("code") or ""), "provider_not_configured")

    def test_runs_non_stream_normalizes_sandbox_fields_before_create_run(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_non_stream_via_stream_executor

        class _FakeProvider:
            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        body = {
            "runId": "r_norm_1",
            "threadId": "t_norm_1",
            "messages": [{"role": "user", "content": "hi"}],
            "composer": {
                "permissionMode": "invalid_mode",
                "dangerousCommandApprovals": [" rm ", "RM", ""],
                "dangerousCommandAllowForThread": 1,
            },
        }
        settings_obj = {"settings": {"workspaceDir": "/tmp/anima-workspace"}}

        with patch("anima_backend_core.api.runs_stream.load_settings", return_value=settings_obj):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.create_run", return_value=None) as p_create_run:
                    with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                        with patch(
                            "anima_backend_core.api.runs_stream._run_coordinator_workers",
                            return_value={
                                "reportsText": "",
                                "traces": [],
                                "artifacts": [],
                                "verification": {"status": "passed", "evidence": []},
                                "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
                            },
                        ):
                            with patch(
                                "anima_backend_core.api.runs_stream._run_tool_loop",
                                return_value={
                                    "paused": False,
                                    "final_content": "ok",
                                    "usage": None,
                                    "traces": [],
                                    "artifacts": [],
                                    "reasoning": "",
                                    "messages": [{"role": "assistant", "content": "ok"}],
                                    "rate_limit": None,
                                    "stop_reason": "completed",
                                    "verification": {"status": "passed", "evidence": []},
                                },
                            ):
                                status, out = handle_post_runs_non_stream_via_stream_executor(body)

        self.assertEqual(int(status), 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(p_create_run.called)
        payload = p_create_run.call_args[0][2] if p_create_run.call_args and len(p_create_run.call_args[0]) >= 3 else {}
        composer = payload.get("composer") if isinstance(payload, dict) else {}
        self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
        self.assertEqual(os.path.realpath(str(composer.get("workspaceDir") or "")), os.path.realpath("/tmp/anima-workspace"))
        self.assertEqual(composer.get("dangerousCommandApprovals"), ["rm"])
        self.assertEqual(bool(composer.get("dangerousCommandAllowForThread")), True)

    def test_runs_stream_normalizes_sandbox_fields_before_create_run(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        body = {
            "runId": "r_norm_stream_1",
            "threadId": "t_norm_stream_1",
            "messages": [{"role": "user", "content": "hi"}],
            "composer": {
                "permissionMode": "invalid_mode",
                "dangerousCommandApprovals": [" rm ", "RM", ""],
                "dangerousCommandAllowForThread": 1,
            },
        }
        settings_obj = {"settings": {"workspaceDir": "/tmp/anima-workspace-stream"}}
        h = self._make_handler(body)

        with patch("anima_backend_core.api.runs_stream.load_settings", return_value=settings_obj):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.create_run", return_value=None) as p_create_run:
                    with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                        with patch(
                            "anima_backend_core.api.runs_stream._run_coordinator_workers",
                            return_value={
                                "reportsText": "",
                                "traces": [],
                                "artifacts": [],
                                "verification": {"status": "passed", "evidence": []},
                                "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
                            },
                        ):
                            with patch(
                                "anima_backend_core.api.runs_stream._run_tool_loop",
                                return_value={
                                    "paused": False,
                                    "final_content": "ok",
                                    "usage": None,
                                    "traces": [],
                                    "artifacts": [],
                                    "reasoning": "",
                                    "messages": [{"role": "assistant", "content": "ok"}],
                                    "rate_limit": None,
                                    "stop_reason": "completed",
                                    "verification": {"status": "passed", "evidence": []},
                                },
                            ):
                                handle_post_runs_stream(h, body)

        self.assertEqual(getattr(h, "_code", 0), 200)
        self.assertTrue(p_create_run.called)
        payload = p_create_run.call_args[0][2] if p_create_run.call_args and len(p_create_run.call_args[0]) >= 3 else {}
        composer = payload.get("composer") if isinstance(payload, dict) else {}
        self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
        self.assertEqual(os.path.realpath(str(composer.get("workspaceDir") or "")), os.path.realpath("/tmp/anima-workspace-stream"))
        self.assertEqual(composer.get("dangerousCommandApprovals"), ["rm"])
        self.assertEqual(bool(composer.get("dangerousCommandAllowForThread")), True)

    def test_run_resume_normalizes_sandbox_fields_before_tool_execution(self) -> None:
        from anima_backend_core.api.runs import handle_post_run_resume

        run_id = "resume_norm_run_1"
        body = {"approvalId": "ap1", "decision": "approve_once", "composer": {"dangerousCommandAllowForThread": 1}}
        h = self._make_handler(body)

        paused_run = {
            "id": run_id,
            "threadId": "t_norm_resume_1",
            "status": "paused",
            "input": {"temperature": 0.7, "maxTokens": 128},
            "output": {
                "pauseContext": {
                    "approvalId": "ap1",
                    "approval": {"code": "dangerous_command_requires_approval", "command": "echo ok", "matchedPattern": "rm"},
                    "pendingToolCall": {"id": "tc1", "name": "bash", "args": {"command": "echo ok"}},
                    "messages": [
                        {"role": "user", "content": "hi"},
                        {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{"id": "tc1", "type": "function", "function": {"name": "bash", "arguments": '{"command":"echo ok"}'}}],
                        },
                    ],
                    "traces": [],
                    "artifacts": [],
                    "composer": {
                        "permissionMode": "invalid_mode",
                        "dangerousCommandApprovals": [" rm ", "RM", ""],
                    },
                    "temperature": 0.7,
                    "maxTokens": 128,
                }
            },
        }

        captured: Dict[str, Any] = {}

        def _fake_execute_tool_with_edit_guard(**kwargs):
            captured["composer"] = kwargs.get("composer")
            trace = {
                "id": "tr_resume_norm",
                "toolCallId": "tc1",
                "name": "bash",
                "status": "succeeded",
                "startedAt": 0,
                "endedAt": 1,
                "durationMs": 1,
            }
            return json.dumps({"ok": True}, ensure_ascii=False), trace

        with patch("anima_backend_core.api.runs.get_run", return_value=paused_run):
            with patch("anima_backend_core.api.runs.load_settings", return_value={"settings": {"workspaceDir": "/tmp/anima-resume-ws"}}):
                with patch("anima_backend_core.api.runs.create_provider", return_value=MockProvider()):
                    with patch("anima_backend_core.api.runs.resolve_runtime_options", return_value=(0.7, 128, None)):
                        with patch("anima_backend_core.api.runs.select_tools", return_value=([], {}, None)):
                            with patch("anima_backend_core.api.runs._run_coordinator_workers", return_value={"reportsText": "", "traces": [], "artifacts": [], "verification": {"status": "passed", "evidence": []}, "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}}}):
                                with patch("anima_backend_core.api.runs._build_edit_guard_state", return_value={"blockedFiles": {}}):
                                    with patch("anima_backend_core.api.runs._execute_tool_with_edit_guard", side_effect=_fake_execute_tool_with_edit_guard):
                                        with patch("anima_backend_core.api.runs._run_tool_loop", return_value={"paused": False, "final_content": "ok", "usage": None, "traces": [], "artifacts": [], "reasoning": "", "messages": [{"role": "assistant", "content": "ok"}], "rate_limit": None, "stop_reason": "completed", "verification": {"status": "passed", "evidence": []}}):
                                            with patch("anima_backend_core.api.runs.update_run", return_value=None):
                                                with patch("anima_backend_core.api.runs.merge_chat_meta", return_value=None):
                                                    handle_post_run_resume(h, run_id)

        composer = captured.get("composer") if isinstance(captured.get("composer"), dict) else {}
        self.assertEqual(str(composer.get("permissionMode") or ""), "workspace_whitelist")
        self.assertEqual(os.path.realpath(str(composer.get("workspaceDir") or "")), os.path.realpath("/tmp/anima-resume-ws"))
        self.assertEqual(composer.get("dangerousCommandApprovals"), ["rm", "echo ok"])
        self.assertEqual(bool(composer.get("dangerousCommandAllowForThread")), True)

    def test_runs_stream_emits_compression_delta_and_end(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def chat_completion_stream(self, _messages, **_kwargs):
                yield {"type": "response.output_text.delta", "delta": "摘要第一段。"}
                yield {"type": "response.output_text.delta", "delta": "摘要第二段。"}
                yield {"type": "response.completed"}

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        def _fake_merge_chat_meta(_chat_id: str, updates: dict):
            comp = {}
            if isinstance(updates, dict):
                meta = updates.get("compression") if isinstance(updates.get("compression"), dict) else {}
                comp = dict(meta)
            return {"compression": comp}

        h = self._make_handler()
        big = "x" * 4000
        history = [
            {"role": "user", "content": big, "id": "m1"},
            {"role": "assistant", "content": big, "id": "m2"},
            {"role": "user", "content": big, "id": "m3"},
            {"role": "assistant", "content": big, "id": "m4"},
            {"role": "user", "content": big, "id": "m5"},
        ]
        body = {
            "threadId": "t1",
            "useThreadMessages": True,
            "messages": [{"role": "user", "content": big}],
            "composer": {"workspaceDir": "/tmp", "contextWindowOverride": 256},
        }
        settings_obj = {"settings": {"enableAutoCompression": True, "compressionThreshold": 10, "keepRecentMessages": 2}}

        with patch("anima_backend_core.api.runs_stream.load_settings", return_value=settings_obj):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.get_chat", return_value={"messages": history}):
                                with patch(
                                    "anima_backend_core.api.runs_stream.get_chat_meta",
                                    return_value={"usageState": {"currentTotalTokens": 99999, "source": "provider", "updatedAt": 1}},
                                ):
                                    with patch("anima_backend_core.api.runs_stream.merge_chat_meta", side_effect=_fake_merge_chat_meta):
                                        handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if not line.startswith("data: "):
                    continue
                events.append(json.loads(line[len("data: ") :]))
        self.assertTrue(any(e.get("type") == "compression_delta" for e in events))
        self.assertTrue(any(e.get("type") == "compression_end" for e in events))

    def test_runs_stream_compression_reports_error_when_stream_empty(self) -> None:
        from anima_backend_core.api.runs_stream import handle_post_runs_stream

        class _FakeProvider:
            def chat_completion_stream(self, _messages, **_kwargs):
                if False:
                    yield {}

            def chat_completion(self, _messages, **_kwargs):
                return {"choices": [{"message": {"role": "assistant", "content": "fallback 摘要"}}]}

        def _fake_merge_chat_meta(_chat_id: str, updates: dict):
            comp = {}
            if isinstance(updates, dict):
                meta = updates.get("compression") if isinstance(updates.get("compression"), dict) else {}
                comp = dict(meta)
            return {"compression": comp}

        h = self._make_handler()
        big = "x" * 4000
        history = [
            {"role": "user", "content": big, "id": "m1"},
            {"role": "assistant", "content": big, "id": "m2"},
            {"role": "user", "content": big, "id": "m3"},
            {"role": "assistant", "content": big, "id": "m4"},
            {"role": "user", "content": big, "id": "m5"},
        ]
        body = {
            "threadId": "t1",
            "useThreadMessages": True,
            "messages": [{"role": "user", "content": big}],
            "composer": {"workspaceDir": "/tmp", "contextWindowOverride": 256},
        }
        settings_obj = {"settings": {"enableAutoCompression": True, "compressionThreshold": 10, "keepRecentMessages": 2}}

        with patch("anima_backend_core.api.runs_stream.load_settings", return_value=settings_obj):
            with patch("anima_backend_core.api.runs_stream.create_provider", return_value=_FakeProvider()):
                with patch("anima_backend_core.api.runs_stream.select_tools", return_value=([], {}, None)):
                    with patch("anima_backend_core.api.runs_stream.create_run", return_value=None):
                        with patch("anima_backend_core.api.runs_stream.update_run", return_value=None):
                            with patch("anima_backend_core.api.runs_stream.get_chat", return_value={"messages": history}):
                                with patch(
                                    "anima_backend_core.api.runs_stream.get_chat_meta",
                                    return_value={"usageState": {"currentTotalTokens": 99999, "source": "provider", "updatedAt": 1}},
                                ):
                                    with patch("anima_backend_core.api.runs_stream.merge_chat_meta", side_effect=_fake_merge_chat_meta):
                                        handle_post_runs_stream(h, body)

        raw = h.wfile.buf.decode("utf-8")
        events = []
        for chunk in raw.split("\n\n"):
            for line in chunk.split("\n"):
                if not line.startswith("data: "):
                    continue
                events.append(json.loads(line[len("data: ") :]))
        end = next((e for e in events if e.get("type") == "compression_end"), None)
        self.assertTrue(isinstance(end, dict) and end.get("ok") is False and "0 events" in str(end.get("error") or ""))
        self.assertEqual(str(((end or {}).get("recovery") or {}).get("reason") or ""), "empty_stream")

    def test_artifacts_file_serves_bytes(self) -> None:
        from anima_backend_core.api.settings_tools import handle_get_artifact_file

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
        from anima_backend_core.api.settings_tools import handle_get_attachment_file

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

    def test_dispatch_chats_crud(self) -> None:
        from anima_backend_core.api import dispatch
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
        from anima_backend_core.api import dispatch
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

                        with patch.object(settings, "list_commands", return_value=("/tmp", [{"id": "bundled:review", "name": "review"}])):
                            h_commands = self._make_handler()
                            self.assertTrue(dispatch(h_commands, "GET", "/commands/list"))
                            out_cmd = self._json_out(h_commands)
                            self.assertTrue(bool(out_cmd.get("ok")))
                            self.assertTrue(isinstance(out_cmd.get("commands"), list))

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

    def test_dispatch_settings_bootstraps_defaults_when_missing(self) -> None:
        from anima_backend_core.api import dispatch
        from anima_backend_shared.database import get_app_settings, get_db_connection, init_db

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        conn = get_db_connection()
                        conn.execute("DELETE FROM app_settings WHERE id = 1")
                        conn.commit()
                        self.assertIsNone(get_app_settings())

                        h_get = self._make_handler()
                        self.assertTrue(dispatch(h_get, "GET", "/settings"))
                        out = self._json_out(h_get)

                        self.assertTrue(isinstance(out.get("settings"), dict))
                        self.assertTrue(isinstance(out.get("providers"), list))

                        persisted = get_app_settings()
                        self.assertTrue(isinstance(persisted, dict))
                        self.assertTrue(isinstance((persisted or {}).get("settings"), dict))

    def test_list_commands_reads_bundled_expand_command_markdown(self) -> None:
        from anima_backend_shared import settings as settings_mod

        td, env, _db, _settings = self._with_temp_config_root()
        with td:
            commands_dir = os.path.join(td.name, "bundled_commands")
            os.makedirs(commands_dir, exist_ok=True)
            with open(os.path.join(commands_dir, "review.md"), "w", encoding="utf-8") as f:
                f.write("# review\n请按代码审查模式检查当前工作区改动。\n")
            with patch.dict(os.environ, {**env, "ANIMA_BUNDLED_COMMANDS_DIR": commands_dir}, clear=False):
                with patch.object(settings_mod, "_CONFIG_ROOT", None):
                    dir_path, commands = settings_mod.list_commands()
                    self.assertEqual(dir_path, commands_dir)
                    self.assertEqual(len(commands), 1)
                    self.assertEqual(str(commands[0].get("name") or ""), "review")
                    self.assertTrue(str(commands[0].get("template") or "").startswith("请按代码审查模式"))

    def test_dispatch_db_export_import_clear(self) -> None:
        from anima_backend_core.api import dispatch
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
        from anima_backend_core.api import dispatch
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
                        with patch("anima_backend_core.api.runs_stream.create_provider", return_value=MockProvider()):
                            self.assertTrue(dispatch(h, "POST", "/api/runs"))
                        out = self._json_out(h)
                        self.assertTrue(bool(out.get("ok")))
                        self.assertEqual(out.get("backendImpl"), "stream-executor")

    def test_dispatch_fetch_models(self) -> None:
        from anima_backend_core.api import dispatch
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

    def test_dispatch_fetch_models_ollama_local_fallback_tags(self) -> None:
        from anima_backend_core.api import dispatch
        from anima_backend_shared.database import init_db, set_app_settings

        td, env, db, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        init_db()
                        set_app_settings({"settings": {}, "providers": []})
                        h = self._make_handler({"providerId": "ollama_local", "baseUrl": "", "apiKey": ""})
                        with patch("anima_backend_shared.providers.fetch_provider_models", side_effect=RuntimeError("boom")):
                            with patch("anima_backend_core.api.settings_tools._fetch_ollama_models_by_tags", return_value=[{"id": "qwen3:8b"}]):
                                self.assertTrue(dispatch(h, "POST", "/api/providers/fetch_models"))
                        out = self._json_out(h)
                        self.assertTrue(bool(out.get("ok")))
                        models = out.get("models") or []
                        self.assertTrue(isinstance(models, list) and len(models) == 1)
                        self.assertEqual(str((models[0] or {}).get("id") or ""), "qwen3:8b")

    def test_dispatch_fetch_models_openai_codex_uses_configured_models(self) -> None:
        from anima_backend_core.api.settings_tools import handle_post_providers_fetch_models

        h = self._make_handler(
            {
                "providerId": "openai_codex",
                "profileId": "default",
                "useCodexOAuth": True,
                "baseUrl": "https://chatgpt.com/backend-api",
                "apiKey": "",
            }
        )
        with patch(
            "anima_backend_core.api.settings_tools.load_settings",
            return_value={
                "providers": [
                    {
                        "id": "openai_codex",
                        "name": "OpenAI Codex (ChatGPT)",
                        "type": "openai_codex",
                        "isEnabled": True,
                        "config": {
                            "baseUrl": "https://chatgpt.com/backend-api",
                            "models": [{"id": "gpt-5.2-codex", "isEnabled": True, "config": {"id": "gpt-5.2-codex"}}],
                        },
                    }
                ]
            },
        ):
            with patch("anima_backend_shared.providers.fetch_provider_models") as fetch_mock:
                handle_post_providers_fetch_models(h)
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertFalse(fetch_mock.called)
        models = out.get("models") or []
        self.assertTrue(isinstance(models, list) and len(models) == 1)
        self.assertEqual(str((models[0] or {}).get("id") or ""), "gpt-5.2-codex")

    def test_dispatch_fetch_models_openai_codex_fallback_includes_new_models(self) -> None:
        from anima_backend_core.api.settings_tools import handle_post_providers_fetch_models

        h = self._make_handler(
            {
                "providerId": "openai_codex",
                "profileId": "default",
                "useCodexOAuth": True,
                "baseUrl": "https://chatgpt.com/backend-api",
                "apiKey": "",
            }
        )
        with patch("anima_backend_core.api.settings_tools.load_settings", return_value={"providers": []}):
            handle_post_providers_fetch_models(h)
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        model_ids = [str((m or {}).get("id") or "") for m in (out.get("models") or [])]
        self.assertIn("gpt-5.4", model_ids)
        self.assertIn("gpt-5.3-codex", model_ids)
        self.assertIn("gpt-5.2-codex", model_ids)

    def test_dispatch_fetch_models_plain_qwen_uses_api_key_not_oauth(self) -> None:
        from anima_backend_core.api.settings_tools import handle_post_providers_fetch_models

        h = self._make_handler(
            {
                "providerId": "qwen",
                "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "apiKey": "DASHSCOPE_KEY",
            }
        )
        with patch("anima_backend_shared.qwen_auth_runtime.resolve_qwen_access_token") as resolve_mock:
            with patch("anima_backend_shared.providers.fetch_provider_models", return_value=[{"id": "qwen-max"}]) as fetch_mock:
                handle_post_providers_fetch_models(h)
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertFalse(resolve_mock.called)
        self.assertTrue(fetch_mock.called)
        self.assertEqual(fetch_mock.call_args.args[0], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(fetch_mock.call_args.args[1], "DASHSCOPE_KEY")

    def test_load_settings_openai_codex_appends_missing_new_models(self) -> None:
        from pathlib import Path

        from anima_backend_shared.database import init_db, set_app_settings
        from anima_backend_shared.settings import load_settings

        td, env, db, settings_mod = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(db, "_DB_INITIALIZED", False):
                        with patch.object(settings_mod, "_CONFIG_ROOT", None):
                            with patch("anima_backend_shared.database.config_root", return_value=Path(td.name)):
                                init_db()
                                set_app_settings(
                                    {
                                        "settings": {},
                                        "providers": [
                                            {
                                                "id": "openai_codex",
                                                "name": "OpenAI Codex (ChatGPT)",
                                                "type": "openai_codex",
                                                "isEnabled": True,
                                                "config": {
                                                    "baseUrl": "https://chatgpt.com/backend-api",
                                                    "apiFormat": "responses",
                                                    "modelsFetched": True,
                                                    "models": [
                                                        {"id": "gpt-5.2-codex", "isEnabled": True, "config": {"id": "gpt-5.2-codex", "contextWindow": 128000}}
                                                    ],
                                                    "selectedModel": "gpt-5.2-codex",
                                                },
                                            }
                                        ],
                                    }
                                )
                                out = load_settings()
        providers = out.get("providers") or []
        codex_provider = next((p for p in providers if str((p or {}).get("id") or "") == "openai_codex"), {})
        models = ((codex_provider or {}).get("config") or {}).get("models") or []
        model_ids = [str((m or {}).get("id") or "") for m in models if isinstance(m, dict)]
        self.assertIn("gpt-5.4", model_ids)
        self.assertIn("gpt-5.3-codex", model_ids)
        self.assertEqual(model_ids.count("gpt-5.2-codex"), 1)

    def test_default_app_settings_include_qwen_provider_and_hidden_qwen_auth_provider(self) -> None:
        from anima_backend_shared.defaults import default_app_settings

        settings_obj = default_app_settings()
        openclaw = settings_obj.get("settings", {}).get("openclaw") or {}
        providers = settings_obj.get("providers") or []
        qwen_provider = next((p for p in providers if str((p or {}).get("id") or "") == "qwen"), {})
        qwen_auth_provider = next((p for p in providers if str((p or {}).get("id") or "") == "qwen_auth"), {})
        codex_provider = next((p for p in providers if str((p or {}).get("id") or "") == "openai_codex"), {})
        provider_ids = [str((p or {}).get("id") or "") for p in providers]
        self.assertFalse("heartbeatEnabled" in openclaw)
        self.assertFalse("heartbeatTelegramChatId" in openclaw)
        self.assertEqual(str((qwen_provider or {}).get("type") or ""), "openai_compatible")
        self.assertEqual(str((qwen_provider or {}).get("name") or ""), "Qwen")
        self.assertEqual(str((((qwen_provider or {}).get("auth") or {}).get("mode") or "")), "")
        self.assertEqual(str((((qwen_provider or {}).get("config") or {}).get("baseUrl") or "")), "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(str((qwen_auth_provider or {}).get("name") or ""), "Qwen Auth")
        self.assertEqual(str((((qwen_auth_provider or {}).get("auth") or {}).get("mode") or "")), "oauth_device_code")
        self.assertTrue(bool((qwen_auth_provider or {}).get("hiddenInSettings")))
        self.assertEqual(str((codex_provider or {}).get("name") or ""), "Codex Auth")
        self.assertEqual(provider_ids.index("openai_codex"), provider_ids.index("qwen_auth") + 1)

    def test_migrate_settings_appends_qwen_provider_and_hidden_qwen_auth_when_missing(self) -> None:
        from anima_backend_shared import settings as settings_mod

        existing = {"settings": {}, "providers": []}
        saved = {}

        def _fake_set_app_settings(obj):
            saved["value"] = obj

        with patch.object(settings_mod, "get_app_settings", return_value=existing):
            with patch.object(settings_mod, "set_app_settings", side_effect=_fake_set_app_settings):
                out = settings_mod.migrate_settings()

        providers = out.get("providers") or []
        qwen_provider = next((p for p in providers if str((p or {}).get("id") or "") == "qwen"), {})
        qwen_auth_provider = next((p for p in providers if str((p or {}).get("id") or "") == "qwen_auth"), {})
        self.assertEqual(str((qwen_provider or {}).get("name") or ""), "Qwen")
        self.assertEqual(str((((qwen_provider or {}).get("auth") or {}).get("mode") or "")), "")
        self.assertEqual(str((qwen_auth_provider or {}).get("name") or ""), "Qwen Auth")
        self.assertEqual(str((((qwen_auth_provider or {}).get("auth") or {}).get("mode") or "")), "oauth_device_code")
        self.assertTrue(bool((qwen_auth_provider or {}).get("hiddenInSettings")))
        self.assertTrue("value" in saved)

    def test_migrate_settings_renames_and_groups_auth_providers(self) -> None:
        from anima_backend_shared import settings as settings_mod

        existing = {
            "settings": {},
            "providers": [
                {"id": "openai", "name": "OpenAI", "type": "openai", "config": {}},
                {
                    "id": "openai_codex",
                    "name": "OpenAI Codex (ChatGPT)",
                    "type": "openai_codex",
                    "auth": {"mode": "oauth_openai_codex", "profileId": "default"},
                    "config": {"baseUrl": "https://chatgpt.com/backend-api", "models": [], "selectedModel": "gpt-5.2-codex"},
                },
                {"id": "anthropic", "name": "Anthropic", "type": "anthropic", "config": {}},
                {
                    "id": "qwen",
                    "name": "Qwen",
                    "type": "openai_compatible",
                    "auth": {"mode": "oauth_device_code", "profileId": "default"},
                    "config": {"baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "models": [], "selectedModel": "coder-model"},
                },
            ],
        }

        with patch.object(settings_mod, "get_app_settings", return_value=existing):
            with patch.object(settings_mod, "set_app_settings"):
                out = settings_mod.migrate_settings()

        providers = out.get("providers") or []
        names = {str((p or {}).get("id") or ""): str((p or {}).get("name") or "") for p in providers}
        ids = [str((p or {}).get("id") or "") for p in providers]
        qwen_auth = next((p for p in providers if str((p or {}).get("id") or "") == "qwen_auth"), {})
        self.assertEqual(names.get("qwen"), "Qwen")
        self.assertEqual(names.get("qwen_auth"), "Qwen Auth")
        self.assertTrue(bool((qwen_auth or {}).get("hiddenInSettings")))
        self.assertEqual(names.get("openai_codex"), "Codex Auth")
        self.assertEqual(ids.index("openai_codex"), ids.index("qwen_auth") + 1)

    def test_reconcile_cron_from_settings_does_not_create_openclaw_heartbeat_job(self) -> None:
        from pathlib import Path

        import anima_backend_core.cron as cron_mod

        td, env, db, settings_mod = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings_mod, "_CONFIG_ROOT", None):
                        with patch("anima_backend_shared.settings.config_root", return_value=Path(td.name)):
                            with patch("anima_backend_core.cron.config_root", return_value=Path(td.name)):
                                cron_mod.reconcile_cron_from_settings(
                                    {
                                        "settings": {
                                            "cron": {"enabled": False},
                                            "openclaw": {
                                                "heartbeatEnabled": True,
                                                "heartbeatTelegramChatId": "123456",
                                            },
                                        }
                                    }
                                )
                                store = cron_mod._load_store()

        jobs = store.get("jobs") or []
        self.assertTrue(isinstance(jobs, list))
        self.assertFalse(any(str((job or {}).get("id") or "") == "cj_openclaw_heartbeat" for job in jobs))

    def test_cron_upsert_run_job_assigns_stable_thread_id(self) -> None:
        import anima_backend_core.cron as cron_mod

        out = cron_mod._upsert_job(
            {
                "id": "cj_daily_bug_scan",
                "name": "Daily bug scan",
                "enabled": True,
                "schedule": {"kind": "every", "everyMs": 3600000},
                "payload": {
                    "kind": "run",
                    "run": {
                        "composer": {"projectId": "p1", "workspaceDir": "/tmp/project"},
                        "messages": [{"role": "user", "content": "scan"}],
                    },
                },
            }
        )

        run = ((out.get("payload") or {}).get("run") or {})
        self.assertEqual(str(run.get("threadMode") or ""), "fixed")
        self.assertEqual(str(run.get("threadId") or ""), "cron_thread_cj_daily_bug_scan")

    def test_execute_job_payload_new_chat_uses_run_id_as_thread(self) -> None:
        import anima_backend_core.cron as cron_mod

        job = {
            "id": "cj_bug_scan_new_chat",
            "name": "Daily bug scan",
            "enabled": True,
            "schedule": {"kind": "every", "everyMs": 3600000},
            "payload": {
                "kind": "run",
                "run": {
                    "threadMode": "new_chat",
                    "threadId": "cron_thread_cj_bug_scan_new_chat",
                    "composer": {"projectId": "p1"},
                    "messages": [{"role": "user", "content": "scan"}],
                },
            },
        }

        seen_bodies = []

        def _fake_handle(body):
            seen_bodies.append(body)
            return 200, {"ok": True, "content": "done"}

        with patch("anima_backend_core.api.runs.handle_post_runs_non_stream", side_effect=_fake_handle):
            with patch("anima_backend_shared.database.merge_chat_meta"):
                with patch("anima_backend_shared.database.get_chat", return_value={"id": "run_new_1", "title": "New Chat"}):
                    with patch("anima_backend_shared.database.update_chat"):
                        result = cron_mod._execute_job_payload(job)

        self.assertTrue(bool(result.get("ok")))
        self.assertEqual(str(result.get("runId") or ""), str(result.get("threadId") or ""))
        self.assertEqual(str(seen_bodies[0].get("threadId") or ""), str(result.get("runId") or ""))

    def test_execute_job_payload_run_updates_chat_meta(self) -> None:
        import anima_backend_core.cron as cron_mod

        job = {
            "id": "cj_bug_scan",
            "name": "Daily bug scan",
            "enabled": True,
            "schedule": {"kind": "every", "everyMs": 3600000},
            "payload": {
                "kind": "run",
                "run": {
                    "threadId": "cron_thread_cj_bug_scan",
                    "composer": {
                        "projectId": "p1",
                        "workspaceDir": "/tmp/project",
                        "providerOverrideId": "openai_codex",
                        "modelOverride": "gpt-5.4",
                    },
                    "messages": [{"role": "user", "content": "scan"}],
                },
            },
        }

        with patch("anima_backend_core.api.runs.handle_post_runs_non_stream", return_value=(200, {"ok": True, "content": "done"})):
            with patch("anima_backend_shared.database.merge_chat_meta") as merge_meta_mock:
                with patch("anima_backend_shared.database.get_chat", return_value={"id": "cron_thread_cj_bug_scan", "title": "New Chat"}):
                    with patch("anima_backend_shared.database.update_chat") as update_chat_mock:
                        result = cron_mod._execute_job_payload(job)

        self.assertTrue(bool(result.get("ok")))
        self.assertEqual(str(result.get("threadId") or ""), "cron_thread_cj_bug_scan")
        merge_meta_mock.assert_called_once()
        self.assertEqual(
            merge_meta_mock.call_args.args,
            (
                "cron_thread_cj_bug_scan",
                {
                    "automationJobId": "cj_bug_scan",
                    "automationJobName": "Daily bug scan",
                    "projectId": "p1",
                    "providerOverrideId": "openai_codex",
                    "modelOverride": "gpt-5.4",
                },
            ),
        )
        update_chat_mock.assert_called_once_with("cron_thread_cj_bug_scan", {"title": "Automation · Daily bug scan"})

    def test_cron_run_thread_appends_run_history(self) -> None:
        from pathlib import Path

        import anima_backend_core.cron as cron_mod

        td, env, db, settings_mod = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db, "_CONFIG_ROOT", None):
                    with patch.object(settings_mod, "_CONFIG_ROOT", None):
                        with patch("anima_backend_shared.settings.config_root", return_value=Path(td.name)):
                            with patch("anima_backend_core.cron.config_root", return_value=Path(td.name)):
                                with patch.object(cron_mod, "_execute_job_payload", return_value={"ok": True, "output": "scan done", "error": None, "runId": "run_1", "threadId": "cron_thread_cj_hist", "projectId": "p1", "providerOverrideId": "openai_codex", "modelOverride": "gpt-5.4"}):
                                    job = cron_mod._upsert_job(
                                        {
                                            "id": "cj_hist",
                                            "name": "History test",
                                            "enabled": True,
                                            "schedule": {"kind": "every", "everyMs": 60000},
                                            "payload": {"kind": "run", "run": {"messages": [{"role": "user", "content": "scan"}]}},
                                        }
                                    )
                                    cron_mod._save_store({"version": 1, "jobs": [job]})

                                    service = cron_mod.CronService()
                                    service._run_job_thread("cj_hist")
                                    store = cron_mod._load_store()

        saved = next((j for j in (store.get("jobs") or []) if str((j or {}).get("id") or "") == "cj_hist"), {})
        history = saved.get("runHistory") or []
        self.assertEqual(len(history), 1)
        self.assertEqual(str(history[0].get("runId") or ""), "run_1")
        self.assertEqual(str(history[0].get("threadId") or ""), "cron_thread_cj_hist")
        self.assertEqual(str(history[0].get("status") or ""), "succeeded")
        self.assertEqual(str(history[0].get("outputPreview") or ""), "scan done")

    def test_dispatch_tts_preview_macos_say(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler({"provider": "macos_say", "model": "Samantha", "speed": 1.2, "text": "你好"})
        with patch("anima_backend_core.api.settings_tools.subprocess.Popen") as popen_mock:
            self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(popen_mock.called)

    def test_dispatch_tts_preview_reject_custom_http_without_endpoint(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler({"provider": "custom_http", "model": "x", "text": "你好"})
        self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertFalse(bool(out.get("ok")))
        self.assertIn("endpoint", str(out.get("error") or ""))

    def test_dispatch_tts_preview_custom_http(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler({"provider": "custom_http", "endpoint": "http://127.0.0.1:18080/tts", "model": "m1", "text": "你好"})
        with patch("anima_backend_core.api.settings_tools._tts_preview_via_http") as preview_http:
            self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(preview_http.called)

    def test_dispatch_tts_preview_qwen_tts_requires_api_key(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler({"provider": "qwen_tts", "model": "Cherry", "text": "你好"})
        self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertFalse(bool(out.get("ok")))
        self.assertIn("apiKey", str(out.get("error") or ""))

    def test_dispatch_tts_preview_qwen_tts_local_endpoint_no_api_key(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler(
            {
                "provider": "qwen_tts",
                "model": "Cherry",
                "qwenModel": "qwen3-tts-flash",
                "qwenLanguageType": "Auto",
                "endpoint": "http://127.0.0.1:8000/tts",
                "text": "你好",
            }
        )
        with patch("anima_backend_core.api.settings_tools._tts_preview_qwen") as preview_qwen:
            self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(preview_qwen.called)

    def test_dispatch_tts_preview_qwen_tts_ok(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler(
            {
                "provider": "qwen_tts",
                "model": "Cherry",
                "qwenModel": "qwen3-tts-flash",
                "qwenLanguageType": "Auto",
                "apiKey": "k",
                "text": "你好",
            }
        )
        with patch("anima_backend_core.api.settings_tools._tts_preview_qwen") as preview_qwen:
            self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(preview_qwen.called)

    def test_dispatch_tts_preview_qwen_tts_local_mode_starts_local_service(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler(
            {
                "provider": "qwen_tts",
                "model": "Cherry",
                "qwenModel": "qwen3-tts-flash",
                "qwenMode": "local",
                "qwenLocalModelId": "qwen3-tts-flash",
                "qwenLocalEndpoint": "http://127.0.0.1:8000/v1/audio/speech",
                "text": "你好",
            }
        )
        with patch("anima_backend_core.api.settings_tools.ensure_qwen_tts_local_service", return_value={"endpoint": "http://127.0.0.1:8000/v1/audio/speech"}) as ensure_mock:
            with patch("anima_backend_core.api.settings_tools._tts_preview_qwen") as preview_qwen:
                self.assertTrue(dispatch(h, "POST", "/api/tts/preview"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertTrue(bool(ensure_mock.called))
        self.assertTrue(bool(preview_qwen.called))

    def test_dispatch_tts_qwen_local_catalog(self) -> None:
        from anima_backend_core.api import dispatch

        h = self._make_handler(None)
        with patch("anima_backend_core.api.qwen_tts.qwen_tts_model_catalog", return_value=[{"id": "qwen3-tts-flash"}]):
            self.assertTrue(dispatch(h, "GET", "/api/tts/qwen/local/catalog"))
        out = self._json_out(h)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str((out.get("models") or [{}])[0].get("id") or ""), "qwen3-tts-flash")

    def test_tts_preview_qwen_local_endpoint_fallback_to_openai_payload(self) -> None:
        import urllib.error
        from anima_backend_core.api.settings_tools import _tts_preview_qwen

        seen_payloads = []

        class _Resp:
            def __init__(self, body: bytes, content_type: str = "application/json") -> None:
                self._body = body
                self.status = 200
                self.headers = {"Content-Type": content_type}

            def read(self) -> bytes:
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def _urlopen(req, data=None, timeout=0):
            payload = json.loads((data or b"{}").decode("utf-8"))
            seen_payloads.append(payload)
            if len(seen_payloads) == 1:
                raise urllib.error.HTTPError(req.full_url, 404, "Not Found", hdrs=None, fp=None)
            return _Resp(b"RIFFfakewav", "audio/wav")

        with patch("anima_backend_core.api.settings_tools.shutil.which", return_value="/usr/bin/afplay"):
            with patch("anima_backend_core.api.settings_tools.urllib.request.urlopen", side_effect=_urlopen):
                with patch("anima_backend_core.api.settings_tools.subprocess.Popen") as popen_mock:
                    _tts_preview_qwen(
                        text="你好",
                        voice="Cherry",
                        qwen_model="qwen3-tts-flash",
                        language_type="Auto",
                        endpoint="http://127.0.0.1:8000/v1/audio/speech",
                        api_key="",
                    )
        self.assertEqual(len(seen_payloads), 2)
        self.assertTrue(isinstance(seen_payloads[0].get("input"), dict))
        self.assertEqual(str(seen_payloads[1].get("input") or ""), "你好")
        self.assertEqual(str(seen_payloads[1].get("response_format") or ""), "wav")
        self.assertTrue(popen_mock.called)

    def test_dispatch_cron_jobs_upsert_and_list(self) -> None:
        from anima_backend_core.api import dispatch
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

        from anima_backend_core import cron

        after_ms = int(datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
        schedule = {"kind": "cron", "expr": "*/5 * * * *", "tz": "UTC"}
        nr = cron._compute_next_run_cron(schedule, after_ms)
        self.assertEqual(nr, after_ms + 5 * 60 * 1000)

    def test_select_tools_hides_cron_tools_when_disabled(self) -> None:
        from anima_backend_core.tools.executor import select_tools

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
        from anima_backend_core.api.voice import handle_get_voice_models_base_dir

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
            with patch.dict(os.environ, {"ANIMA_CONFIG_ROOT": d, "ANIMA_SKILLS_DIR": os.path.join(d, "skills")}):
                with patch.object(settings, "_CONFIG_ROOT", None):
                    handle_get_voice_models_base_dir(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"dir"', out)

    def test_voice_catalog_uses_handler(self) -> None:
        from anima_backend_core.api.voice import handle_get_voice_models_catalog

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
            "anima_backend_core.api.voice.voice_model_catalog",
            return_value=[{"id": "openai/whisper-tiny", "name": "Whisper Tiny", "sizeBytes": 123}],
        ):
            handle_get_voice_models_catalog(h)
        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"openai/whisper-tiny"', out)

    def test_voice_download_status_requires_task_id(self) -> None:
        from anima_backend_core.api.voice import handle_get_voice_models_download_status

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
        from anima_backend_core.api.voice import (
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

        with patch("anima_backend_core.api.voice.voice_model_catalog", return_value=[{"id": "openai/whisper-tiny"}]):
            with patch("anima_backend_core.api.voice._start_download_task", return_value="task123"):
                handle_post_voice_models_download(h)

        out = h.wfile.buf.decode("utf-8")
        self.assertIn('"ok": true', out)
        self.assertIn('"taskId": "task123"', out)

        from anima_backend_core.api import voice as lg_voice

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
        from anima_backend_core.api.voice import handle_post_voice_transcribe

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
        from anima_backend_core import telegram_integration as tg

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
        from anima_backend_core import telegram_integration as tg
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

    def test_qwen_oauth_device_flow_stores_credentials_and_resolves_provider_spec(self) -> None:
        from pathlib import Path

        from anima_backend_shared import database as db
        from anima_backend_shared import provider_credentials as cred_store
        from anima_backend_shared import providers as shared_providers

        td, env, db_mod, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db_mod, "_CONFIG_ROOT", None):
                    with patch.object(db_mod, "_DB_INITIALIZED", False):
                        with patch("anima_backend_shared.database.config_root", return_value=Path(td.name)):
                            db.init_db()
                            db.set_app_settings(
                                {
                                    "settings": {"defaultToolMode": "all"},
                                    "providers": [
                                        {
                                            "id": "qwen",
                                            "name": "Qwen",
                                            "type": "openai_compatible",
                                            "isEnabled": True,
                                            "auth": {"mode": "oauth_device_code", "profileId": "default"},
                                            "config": {"baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "models": [], "selectedModel": "coder-model"},
                                        }
                                    ],
                                }
                            )

                            from anima_backend_core.api import qwen_auth as api_qwen_auth

                            fake_device = {
                                "device_code": "dc",
                                "user_code": "UCODE",
                                "verification_uri": "https://chat.qwen.ai/verify",
                                "verification_uri_complete": "https://chat.qwen.ai/verify?code=UCODE",
                                "expires_in": 600,
                                "interval": 1,
                            }
                            fake_token_result = {
                                "status": "success",
                                "token": {
                                    "accessToken": "ACCESS",
                                    "refreshToken": "REFRESH",
                                    "expiresAt": int(time.time() * 1000) + 3600 * 1000,
                                    "resourceUrl": "https://portal.qwen.ai",
                                },
                            }

                            with patch.object(api_qwen_auth, "qwen_generate_pkce_verifier_challenge", return_value=("v", "c")):
                                with patch.object(api_qwen_auth, "request_device_code", return_value=fake_device):
                                    h1 = self._make_handler({"providerId": "qwen", "profileId": "default"})
                                    api_qwen_auth.handle_post_provider_auth_start(h1)
                                    out1 = self._json_out(h1)
                                    self.assertTrue(out1.get("ok") is True)
                                    flow_id = str(out1.get("flowId") or "")
                                    self.assertTrue(flow_id)

                            with patch.object(api_qwen_auth, "poll_device_token", return_value=fake_token_result):
                                h2 = self._make_handler(query={"flowId": flow_id})
                                api_qwen_auth.handle_get_provider_auth_status(h2)
                            out2 = self._json_out(h2)
                            self.assertTrue(out2.get("ok") is True)
                            self.assertEqual(str(out2.get("state")), "success")

                        cred = cred_store.get_oauth_credential("qwen", "default")
                        self.assertTrue(isinstance(cred, dict))
                        self.assertEqual(str(cred.get("accessToken")), "ACCESS")

                        spec = shared_providers.get_provider_spec(db.get_app_settings(), "qwen")
                        self.assertTrue(spec is not None)
                        self.assertEqual(spec.provider_id, "qwen")
                        self.assertEqual(spec.api_key, "ACCESS")
                        self.assertEqual(str(spec.base_url), "https://dashscope.aliyuncs.com/compatible-mode/v1")

    def test_openai_codex_oauth_resolves_provider_spec(self) -> None:
        from anima_backend_shared import database as db
        from anima_backend_shared import provider_credentials as cred_store
        from anima_backend_shared import providers as shared_providers

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
                                        "id": "codex1",
                                        "name": "OpenAI Codex (ChatGPT)",
                                        "type": "openai_codex",
                                        "isEnabled": True,
                                        "auth": {"mode": "oauth_openai_codex", "profileId": "default"},
                                        "config": {"baseUrl": "https://chatgpt.com/backend-api", "models": [], "selectedModel": "gpt-5.2-codex"},
                                    }
                                ],
                            }
                        )

                        cred_store.upsert_oauth_credential(
                            {
                                "providerId": "openai_codex",
                                "profileId": "default",
                                "accessToken": "tok.part.sig",
                                "refreshToken": "REFRESH",
                                "expiresAt": int(time.time() * 1000) + 3600 * 1000,
                                "resourceUrl": "acct_123",
                            }
                        )

                        spec = shared_providers.get_provider_spec(db.get_app_settings(), "codex1")
                        self.assertTrue(spec is not None)
                        self.assertEqual(str(spec.provider_type), "openai_codex")
                        self.assertEqual(str(spec.api_key), "tok.part.sig")
                        self.assertEqual(str((spec.extra_headers or {}).get("chatgpt-account-id") or ""), "acct_123")

    def test_openai_codex_sync_from_auth_json_stores_credentials(self) -> None:
        from anima_backend_shared import database as db
        from anima_backend_shared import provider_credentials as cred_store

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
                                        "id": "codex1",
                                        "name": "Codex Auth",
                                        "type": "openai_codex",
                                        "isEnabled": True,
                                        "auth": {"mode": "oauth_openai_codex", "profileId": "default"},
                                        "config": {"baseUrl": "https://chatgpt.com/backend-api", "models": [], "selectedModel": "gpt-5.4"},
                                    }
                                ],
                            }
                        )

                        auth_root = os.path.join(td.name, "codex-home")
                        os.makedirs(auth_root, exist_ok=True)
                        expires_at = int(time.time() * 1000) + 3600 * 1000
                        with open(os.path.join(auth_root, "auth.json"), "w", encoding="utf-8") as f:
                            json.dump(
                                {
                                    "tokens": {
                                        "access_token": "tok.part.sig",
                                        "refresh_token": "REFRESH",
                                        "expires_at": expires_at,
                                    },
                                    "chatgpt_account_id": "acct_sync",
                                    "email": "sync-user@example.com",
                                },
                                f,
                                ensure_ascii=False,
                            )

                        from anima_backend_core.api import qwen_auth as api_qwen_auth

                        h = self._make_handler({"providerId": "codex1", "profileId": "default", "authRootDir": auth_root})
                        api_qwen_auth.handle_post_provider_auth_sync(h)
                        out = self._json_out(h)
                        self.assertEqual(int(getattr(h, "_code", 0)), 200)
                        self.assertTrue(bool(out.get("ok")))
                        self.assertEqual(str(out.get("state") or ""), "success")
                        self.assertEqual(os.path.realpath(str(((out.get("source") or {}).get("authRootDir") or "")),), os.path.realpath(auth_root))

                        cred = cred_store.get_oauth_credential("openai_codex", "default")
                        self.assertTrue(isinstance(cred, dict))
                        self.assertEqual(str(cred.get("accessToken") or ""), "tok.part.sig")
                        self.assertEqual(str(cred.get("refreshToken") or ""), "REFRESH")
                        self.assertEqual(str(cred.get("resourceUrl") or ""), "acct_sync")
                        self.assertEqual(str(cred.get("email") or ""), "sync-user@example.com")
                        self.assertEqual(int(cred.get("expiresAt") or 0), expires_at)

                        h_profiles = self._make_handler(query={"providerId": "codex1"})
                        api_qwen_auth.handle_get_provider_auth_profiles(h_profiles)
                        out_profiles = self._json_out(h_profiles)
                        self.assertEqual(int(getattr(h_profiles, "_code", 0)), 200)
                        self.assertTrue(bool(out_profiles.get("ok")))
                        profiles = out_profiles.get("profiles")
                        self.assertTrue(isinstance(profiles, list))
                        self.assertEqual(str((profiles[0] or {}).get("email") or ""), "sync-user@example.com")

    def test_openai_codex_sync_rejects_non_codex_provider(self) -> None:
        from anima_backend_shared import database as db

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
                                        "id": "qwen1",
                                        "name": "Qwen",
                                        "type": "openai_compatible",
                                        "isEnabled": True,
                                        "config": {"baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "models": [], "selectedModel": "coder-model"},
                                    }
                                ],
                            }
                        )

                        from anima_backend_core.api import qwen_auth as api_qwen_auth

                        h = self._make_handler({"providerId": "qwen1", "profileId": "default"})
                        api_qwen_auth.handle_post_provider_auth_sync(h)
                        out = self._json_out(h)
                        self.assertEqual(int(getattr(h, "_code", 0)), 400)
                        self.assertFalse(bool(out.get("ok")))
                        self.assertIn("Codex", str(out.get("error") or ""))

    def test_provider_base_url_strips_wrapping_backticks(self) -> None:
        from anima_backend_shared import database as db
        from anima_backend_shared import providers as shared_providers

        td, env, db_mod, _settings = self._with_temp_config_root()
        with td:
            with patch.dict(os.environ, env):
                with patch.object(db_mod, "_CONFIG_ROOT", None):
                    with patch.object(db_mod, "_DB_INITIALIZED", False):
                        db.init_db()
                        db.set_app_settings(
                            {
                                "settings": {},
                                "providers": [
                                    {
                                        "id": "p1",
                                        "name": "OpenAI",
                                        "type": "openai",
                                        "isEnabled": True,
                                        "config": {"baseUrl": "`https://api.openai.com`", "apiKey": "x", "selectedModel": "m"},
                                    }
                                ],
                            }
                        )
                        spec = shared_providers.get_provider_spec(db.get_app_settings(), "p1")
                        self.assertTrue(spec is not None)
                        self.assertEqual(str(spec.base_url), "https://api.openai.com")

    def test_provider_spec_proxy_mode_manual_uses_settings_proxy(self) -> None:
        from anima_backend_shared import providers as shared_providers

        settings_obj = {
            "settings": {"proxyMode": "manual", "proxyUrl": "127.0.0.1:7890"},
            "providers": [
                {
                    "id": "p1",
                    "name": "OpenAI",
                    "type": "openai",
                    "isEnabled": True,
                    "config": {"baseUrl": "https://api.openai.com", "apiKey": "x", "selectedModel": "m"},
                }
            ],
        }
        spec = shared_providers.get_provider_spec(settings_obj, "p1")
        self.assertTrue(spec is not None)
        self.assertEqual(str((spec or object()).proxy_url), "http://127.0.0.1:7890")

    def test_provider_spec_proxy_mode_auto_uses_env_proxy(self) -> None:
        from anima_backend_shared import providers as shared_providers

        settings_obj = {
            "settings": {"proxyMode": "auto", "proxyUrl": "127.0.0.1:7890"},
            "providers": [
                {
                    "id": "p1",
                    "name": "OpenAI",
                    "type": "openai",
                    "isEnabled": True,
                    "config": {"baseUrl": "https://api.openai.com", "apiKey": "x", "selectedModel": "m"},
                }
            ],
        }
        with patch.dict(os.environ, {"HTTPS_PROXY": "127.0.0.1:8888"}, clear=True):
            spec = shared_providers.get_provider_spec(settings_obj, "p1")
        self.assertTrue(spec is not None)
        self.assertEqual(str((spec or object()).proxy_url), "http://127.0.0.1:8888")

    def test_provider_spec_proxy_mode_legacy_fallback_manual(self) -> None:
        from anima_backend_shared import providers as shared_providers

        settings_obj = {
            "settings": {"proxyUrl": "127.0.0.1:9000"},
            "providers": [
                {
                    "id": "p1",
                    "name": "OpenAI",
                    "type": "openai",
                    "isEnabled": True,
                    "config": {"baseUrl": "https://api.openai.com", "apiKey": "x", "selectedModel": "m"},
                }
            ],
        }
        with patch.dict(os.environ, {"HTTPS_PROXY": "127.0.0.1:9999"}, clear=True):
            spec = shared_providers.get_provider_spec(settings_obj, "p1")
        self.assertTrue(spec is not None)
        self.assertEqual(str((spec or object()).proxy_url), "http://127.0.0.1:9000")

    def test_network_proxy_detect_endpoint_reads_env(self) -> None:
        from anima_backend_core.api import settings_tools

        with patch.dict(os.environ, {"HTTP_PROXY": "127.0.0.1:18888"}, clear=True):
            h = self._make_handler()
            settings_tools.handle_get_network_proxy_detect(h)
            out = self._json_out(h)
        self.assertEqual(int(getattr(h, "_code", 0)), 200)
        self.assertEqual(bool(out.get("ok")), True)
        self.assertEqual(bool(out.get("enabled")), True)
        self.assertEqual(str(out.get("proxyUrl") or ""), "http://127.0.0.1:18888")
        self.assertEqual(str(out.get("source") or ""), "HTTP_PROXY")

    def test_detect_proxy_from_env_fallback_to_macos_scutil(self) -> None:
        from anima_backend_shared import providers as shared_providers

        fake_scutil = "\n".join(
            [
                "HTTPEnable : 1",
                "HTTPProxy : 127.0.0.1",
                "HTTPPort : 7899",
            ]
        )

        class _CP:
            def __init__(self) -> None:
                self.returncode = 0
                self.stdout = fake_scutil

        with patch.dict(os.environ, {}, clear=True):
            with patch("anima_backend_shared.providers.platform.system", return_value="Darwin"):
                with patch("anima_backend_shared.providers.subprocess.run", return_value=_CP()):
                    proxy, source = shared_providers.detect_proxy_from_env()

        self.assertEqual(proxy, "http://127.0.0.1:7899")
        self.assertEqual(source, "macos_scutil_http")

    def test_openai_codex_chat_completion_aggregates_stream(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        def _fake_stream(*_args, **_kwargs):
            yield {"choices": [{"delta": {"content": "hi"}, "finish_reason": None}]}
            yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

        p.chat_completion_stream = _fake_stream
        out = p.chat_completion([{"role": "user", "content": "x"}], temperature=0, max_tokens=16)
        msg = ((out.get("choices") or [{}])[0] or {}).get("message") or {}
        self.assertEqual(str(msg.get("content") or ""), "hi")

    def test_openai_compatible_chat_completion_aggregates_stream(self) -> None:
        from anima_backend_shared.providers import OpenAIChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="qwen1",
            provider_type="openai_compatible",
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key="ACCESS",
            model="qwen-max",
            proxy_url="",
            thinking_enabled=False,
            api_format="chat_completions",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAIChatProvider(spec)

        def _fake_stream(*_args, **_kwargs):
            yield {"choices": [{"delta": {"content": "he"}, "finish_reason": None}]}
            yield {"choices": [{"delta": {"content": "llo"}, "finish_reason": None}]}
            yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

        p.chat_completion_stream = _fake_stream
        out = p.chat_completion([{"role": "user", "content": "x"}], temperature=0, max_tokens=16)
        msg = ((out.get("choices") or [{}])[0] or {}).get("message") or {}
        self.assertEqual(str(msg.get("content") or ""), "hello")

    def test_openai_codex_stream_falls_back_when_upstream_empty(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def __init__(self) -> None:
                self.buf = b""

            def write(self, b: bytes) -> None:
                self.buf += b

            def close(self) -> None:
                return

        class _StdOut:
            def readline(self) -> bytes:
                return b""

            def read(self, _n: int = -1) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def kill(self) -> None:
                return

            def wait(self, timeout=None) -> int:
                return 0

        def _fake_json(_url, _headers, _payload, timeout_s: int):
            return {
                "response": {
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}],
                }
            }

        import anima_backend_shared.providers as prov_mod

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(p, "_codex_request_stream_to_text", return_value="ok"):
                    evts = list(
                        p.chat_completion_stream(
                            [{"role": "user", "content": "hi"}],
                            temperature=0.2,
                            max_tokens=16,
                            tools=None,
                            tool_choice=None,
                            model_override=None,
                            extra_body=None,
                        )
                    )
        text = ""
        for e in evts:
            c0 = ((e.get("choices") or [{}])[0]) if isinstance(e, dict) else {}
            d0 = (c0.get("delta") or {}) if isinstance(c0, dict) else {}
            part = d0.get("content")
            if isinstance(part, str):
                text += part
        self.assertEqual(text, "ok")

    def test_openai_codex_payload_includes_instructions(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)
        payload = p._codex_payload(  # type: ignore[attr-defined]
            [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}],
            temperature=0.2,
            max_tokens=16,
            model_override=None,
            extra_body=None,
        )
        self.assertEqual(str(payload.get("instructions") or ""), "SYS")
        self.assertTrue("temperature" not in payload)
        self.assertTrue("max_tokens" not in payload)
        self.assertTrue("max_output_tokens" not in payload)

        payload2 = p._codex_payload(  # type: ignore[attr-defined]
            [{"role": "user", "content": "hi"}],
            temperature=0.2,
            max_tokens=16,
            model_override=None,
            extra_body=None,
        )
        self.assertTrue(isinstance(payload2.get("instructions"), str) and str(payload2.get("instructions") or "").strip())
        self.assertTrue("temperature" not in payload2)
        self.assertTrue("max_tokens" not in payload2)
        self.assertTrue("max_output_tokens" not in payload2)

    def test_openai_codex_payload_maps_tool_history_and_tools(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "list_dir",
                    "description": "列目录",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                    },
                },
            }
        ]
        payload = p._codex_payload(  # type: ignore[attr-defined]
            [
                {"role": "system", "content": "SYS"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "list_dir", "arguments": '{"path":"","maxEntries":5}'},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": '{"entries":["a"]}'},
                {"role": "tool", "tool_call_id": "missing_call", "content": "孤儿工具结果"},
                {"role": "assistant", "content": "done"},
            ],
            temperature=0.2,
            max_tokens=16,
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "list_dir"}},
            model_override=None,
            extra_body=None,
        )
        self.assertEqual(
            payload.get("tools"),
            [
                {
                    "type": "function",
                    "name": "list_dir",
                    "description": "列目录",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                    },
                    "strict": False,
                }
            ],
        )
        self.assertEqual(payload.get("tool_choice"), {"type": "function", "name": "list_dir"})
        self.assertEqual(
            payload.get("input"),
            [
                {"role": "user", "content": "hi"},
                {"type": "function_call", "call_id": "call_1", "name": "list_dir", "arguments": '{"path":"","maxEntries":5}'},
                {"type": "function_call_output", "call_id": "call_1", "output": '{"entries":["a"]}'},
                {"role": "assistant", "content": "done"},
            ],
        )

    def test_openai_codex_chat_completion_stream_emits_tool_call_deltas(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def __init__(self) -> None:
                self._lines = [
                    b"HTTP/1.1 200 OK\r\n",
                    b"Content-Type: text/event-stream\r\n",
                    b"\r\n",
                    b'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"list_dir","arguments":""}}\n',
                    b"\n",
                    b'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"{\\"path\\":\\"\\""}\n',
                    b"\n",
                    b'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":",\\"maxEntries\\":5}"}\n',
                    b"\n",
                    b'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"list_dir","arguments":"{\\"path\\":\\"\\",\\"maxEntries\\":5}"}}\n',
                    b"\n",
                    b'data: {"type":"response.done","response":{"output":[{"id":"fc_1","type":"function_call","call_id":"call_1","name":"list_dir","arguments":"{\\"path\\":\\"\\",\\"maxEntries\\":5}"}]}}\n',
                    b"\n",
                ]
                self._i = 0

            def readline(self) -> bytes:
                if self._i >= len(self._lines):
                    return b""
                line = self._lines[self._i]
                self._i += 1
                return line

            def read(self, _n: int = -1) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def poll(self):
                return 0

            def wait(self, timeout=None) -> int:
                return 0

        import anima_backend_shared.providers as prov_mod

        def _select(_r, _w, _e, _t):
            return (_r, _w, _e)

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(prov_mod.select, "select", side_effect=_select):
                    events = list(
                        p.chat_completion_stream(
                            [{"role": "user", "content": "hi"}],
                            temperature=0.2,
                            max_tokens=16,
                            tools=[
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "list_dir",
                                        "description": "列目录",
                                        "parameters": {"type": "object"},
                                    },
                                }
                            ],
                        )
                    )
        tool_deltas = []
        for evt in events:
            choice = ((evt.get("choices") or [{}])[0]) if isinstance(evt, dict) else {}
            delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
            tc_list = delta.get("tool_calls")
            if isinstance(tc_list, list):
                tool_deltas.extend(tc_list)
        self.assertEqual(
            tool_deltas,
            [
                {"index": 0, "id": "call_1", "type": "function", "function": {"name": "list_dir", "arguments": ""}},
                {"index": 0, "function": {"arguments": '{"path":""'}},
                {"index": 0, "function": {"arguments": ',"maxEntries":5}'}},
            ],
        )

    def test_openai_codex_stream_does_not_stop_on_reasoning_item_done(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def __init__(self) -> None:
                self._lines = [
                    b"HTTP/1.1 200 OK\r\n",
                    b"Content-Type: text/event-stream\r\n",
                    b"\r\n",
                    b'data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}\n',
                    b"\n",
                    b'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}\n',
                    b"\n",
                    b'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}\n',
                    b"\n",
                    b'data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"list_dir","arguments":""}}\n',
                    b"\n",
                    b'data: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_1","delta":"{\\"path\\":\\"\\"}"}\n',
                    b"\n",
                    b'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n',
                    b"\n",
                ]
                self._i = 0

            def readline(self) -> bytes:
                if self._i >= len(self._lines):
                    return b""
                line = self._lines[self._i]
                self._i += 1
                return line

            def read(self, _n: int = -1) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def poll(self):
                return 0

            def wait(self, timeout=None) -> int:
                return 0

        import anima_backend_shared.providers as prov_mod

        def _select(_r, _w, _e, _t):
            return (_r, _w, _e)

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(prov_mod.select, "select", side_effect=_select):
                    events = list(
                        p.chat_completion_stream(
                            [{"role": "user", "content": "hi"}],
                            temperature=0.2,
                            max_tokens=16,
                            tools=[
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "list_dir",
                                        "description": "列目录",
                                        "parameters": {"type": "object"},
                                    },
                                }
                            ],
                        )
                    )
        tool_deltas = []
        for evt in events:
            choice = ((evt.get("choices") or [{}])[0]) if isinstance(evt, dict) else {}
            delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
            tc_list = delta.get("tool_calls")
            if isinstance(tc_list, list):
                tool_deltas.extend(tc_list)
        self.assertEqual(
            tool_deltas,
            [
                {"index": 1, "id": "call_1", "type": "function", "function": {"name": "list_dir", "arguments": ""}},
                {"index": 1, "function": {"arguments": '{"path":""}'}},
            ],
        )

    def test_openai_codex_chat_completion_aggregates_tool_calls(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        def _fake_stream(*_args, **_kwargs):
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "call_1", "type": "function", "function": {"name": "list_dir", "arguments": ""}}
                            ]
                        }
                    }
                ]
            }
            yield {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"path":""}'}}]}}]}
            yield {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}

        p.chat_completion_stream = _fake_stream
        out = p.chat_completion(
            [{"role": "user", "content": "x"}],
            temperature=0,
            max_tokens=16,
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "list_dir",
                        "description": "列目录",
                        "parameters": {"type": "object"},
                    },
                }
            ],
        )
        msg = ((out.get("choices") or [{}])[0] or {}).get("message") or {}
        self.assertEqual(
            msg.get("tool_calls"),
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "list_dir", "arguments": '{"path":""}'},
                }
            ],
        )

    def test_openai_codex_extracts_output_text_delta_events(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)
        d1 = p._extract_text_delta({"type": "response.output_text.delta", "delta": "h"})  # type: ignore[attr-defined]
        d2 = p._extract_text_delta({"type": "response.output_text.delta", "text": "i"})  # type: ignore[attr-defined]
        self.assertEqual(d1 + d2, "hi")

    def test_openai_codex_handles_proxy_double_http_headers(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="http://127.0.0.1:7890",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def __init__(self) -> None:
                self._lines = [
                    b"HTTP/1.1 200 Connection established\r\n",
                    b"Proxy-Agent: test\r\n",
                    b"\r\n",
                    b"HTTP/1.1 400 Bad Request\r\n",
                    b"Content-Type: application/json\r\n",
                    b"\r\n",
                ]
                self._i = 0
                self._rest = b'{"detail":"bad"}'

            def readline(self) -> bytes:
                if self._i >= len(self._lines):
                    return b""
                b = self._lines[self._i]
                self._i += 1
                return b

            def read(self, _n: int = -1) -> bytes:
                out = self._rest
                self._rest = b""
                return out

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def kill(self) -> None:
                return

            def wait(self, timeout=None) -> int:
                return 0

        import anima_backend_shared.providers as prov_mod

        def _select(_r, _w, _e, _t):
            return (_r, _w, _e)

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(prov_mod.select, "select", side_effect=_select):
                    with self.assertRaises(RuntimeError) as ctx:
                        p._codex_request_stream_to_text(  # type: ignore[attr-defined]
                            "https://chatgpt.com/backend-api/codex/responses",
                            {"Accept": "text/event-stream"},
                            {"stream": True},
                            timeout_s=5,
                        )
        self.assertIn("Upstream HTTP 400", str(ctx.exception))

    def test_openai_codex_fallback_timeout_has_readable_error(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="ACCESS",
            model="gpt-5.2-codex",
            proxy_url="http://127.0.0.1:7890",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def readline(self) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()
                self.returncode = None
                self.terminated = False

            def poll(self):
                return self.returncode

            def terminate(self) -> None:
                self.terminated = True
                self.returncode = -15

            def kill(self) -> None:
                self.returncode = -9

            def wait(self, timeout=None) -> int:
                if self.returncode is None:
                    self.returncode = 0
                return int(self.returncode)

        import anima_backend_shared.providers as prov_mod

        times = [0.0, 100.0]

        def _time():
            return times.pop(0) if times else 100.0

        def _select(_r, _w, _e, _t):
            return ([], [], [])

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(prov_mod.time, "time", side_effect=_time):
                    with patch.object(prov_mod.select, "select", side_effect=_select):
                        with self.assertRaises(RuntimeError) as ctx:
                            p._codex_request_stream_to_text(  # type: ignore[attr-defined]
                                "https://chatgpt.com/backend-api/codex/responses",
                                {"Accept": "text/event-stream"},
                                {"stream": True},
                                timeout_s=1,
                            )
        self.assertIn("Codex upstream timeout", str(ctx.exception))

    def test_openai_codex_stream_sigkill_triggers_fallback(self) -> None:
        from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec

        spec = ProviderSpec(
            provider_id="codex1",
            provider_type="openai_codex",
            base_url="https://chatgpt.com/backend-api",
            api_key="tok.part.sig",
            model="gpt-5.2-codex",
            proxy_url="http://127.0.0.1:7890",
            thinking_enabled=False,
            api_format="responses",
            use_max_completion_tokens=False,
            extra_headers={"chatgpt-account-id": "acct_123", "OpenAI-Beta": "responses=experimental", "originator": "codex_cli_rs"},
        )
        p = OpenAICodexChatProvider(spec)

        class _StdIn:
            def write(self, _b: bytes) -> None:
                return

            def close(self) -> None:
                return

        class _StdOut:
            def readline(self) -> bytes:
                return b""

            def read(self, _n: int = -1) -> bytes:
                return b""

        class _StdErr:
            def read(self) -> bytes:
                return b""

        class _P:
            def __init__(self, *_args, **_kwargs) -> None:
                self.stdin = _StdIn()
                self.stdout = _StdOut()
                self.stderr = _StdErr()

            def kill(self) -> None:
                return

            def wait(self, timeout=None) -> int:
                return -9

        import anima_backend_shared.providers as prov_mod

        with patch.object(prov_mod.shutil, "which", return_value="curl"):
            with patch.object(prov_mod.subprocess, "Popen", _P):
                with patch.object(p, "_codex_request_stream_to_text", return_value="hi"):  # type: ignore[attr-defined]
                    out = ""
                    for evt in p.chat_completion_stream([{"role": "user", "content": "x"}], temperature=0.2, max_tokens=16):
                        choice = ((evt.get("choices") or [{}])[0]) if isinstance(evt, dict) else {}
                        delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
                        part = delta.get("content")
                        if isinstance(part, str) and part:
                            out += part
                    self.assertEqual(out, "hi")

    def test_bash_full_access_allows_blocked_patterns(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                shared_tools,
                "run_bash_with_os_sandbox",
                return_value={
                    "ok": True,
                    "exitCode": 0,
                    "stdout": "ok\n",
                    "stderr": "",
                    "truncated": {"stdout": False, "stderr": False},
                    "cwd": td,
                    "sandbox": {"enabled": False, "kind": "none", "reason": "permission_mode_full_access"},
                },
            ) as p_run:
                out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "bash",
                        {
                            "command": "rm -rf ./tmpdir",
                            "_animaPermissionMode": "full_access",
                        },
                        workspace_dir=td,
                    )
                )
                self.assertTrue(bool(out.get("ok")))
                self.assertEqual(int(out.get("exitCode")) if out.get("exitCode") is not None else -1, 0)
                self.assertTrue(p_run.called)

    def test_os_sandbox_runner_wraps_command_with_sandbox_exec_on_darwin(self) -> None:
        import anima_backend_shared.os_sandbox_runner as runner

        with tempfile.TemporaryDirectory() as td:
            captured: Dict[str, Any] = {}

            class _Proc:
                returncode = 0
                stdout = "ok\n"
                stderr = ""

            def _fake_run(cmd, **kwargs):
                captured["cmd"] = cmd
                captured["kwargs"] = kwargs
                return _Proc()

            with patch.object(runner.sys, "platform", "darwin"):
                with patch.object(runner.subprocess, "run", side_effect=_fake_run):
                    out = runner.run_bash_with_os_sandbox(
                        command="echo ok",
                        cwd=td,
                        timeout_ms=3000,
                        permission_mode="workspace_whitelist",
                        workspace_dir=td,
                        allowed_roots=[],
                        env={"PATH": "/usr/bin", "HOME": td},
                    )

            cmd = captured.get("cmd") if isinstance(captured.get("cmd"), list) else []
            self.assertTrue(len(cmd) >= 6)
            self.assertEqual(str(cmd[0]), "sandbox-exec")
            self.assertEqual(str(cmd[1]), "-p")
            self.assertEqual(str(cmd[3]), "/bin/bash")
            self.assertEqual(str(cmd[4]), "-c")
            self.assertEqual(str(cmd[5]), "echo ok")
            self.assertTrue(bool((out.get("sandbox") or {}).get("enabled")))
            self.assertEqual(str((out.get("sandbox") or {}).get("kind") or ""), "macos_sandbox_exec")

    def test_os_sandbox_runner_skips_sandbox_in_full_access(self) -> None:
        import anima_backend_shared.os_sandbox_runner as runner

        with tempfile.TemporaryDirectory() as td:
            captured: Dict[str, Any] = {}

            class _Proc:
                returncode = 0
                stdout = "ok\n"
                stderr = ""

            def _fake_run(cmd, **kwargs):
                captured["cmd"] = cmd
                captured["kwargs"] = kwargs
                return _Proc()

            with patch.object(runner.sys, "platform", "darwin"):
                with patch.object(runner.subprocess, "run", side_effect=_fake_run):
                    out = runner.run_bash_with_os_sandbox(
                        command="echo ok",
                        cwd=td,
                        timeout_ms=3000,
                        permission_mode="full_access",
                        workspace_dir=td,
                        allowed_roots=[],
                        env={"PATH": "/usr/bin", "HOME": td},
                    )

            cmd = captured.get("cmd") if isinstance(captured.get("cmd"), list) else []
            self.assertEqual(cmd, ["/bin/bash", "-c", "echo ok"])
            self.assertFalse(bool((out.get("sandbox") or {}).get("enabled")))
            self.assertEqual(str((out.get("sandbox") or {}).get("kind") or ""), "none")

    def test_builtin_tools_replace_write_edit_with_apply_patch(self) -> None:
        import anima_backend_shared.tools as shared_tools

        tools = shared_tools.builtin_tools()
        names = [str(((t.get("function") or {}) if isinstance(t, dict) else {}).get("name") or "") for t in tools]
        self.assertIn("apply_patch", names)
        self.assertIn("multi_tool_use_parallel", names)
        self.assertIn("memory_add", names)
        self.assertIn("memory_query", names)
        self.assertIn("memory_link", names)
        self.assertIn("memory_graph_query", names)
        self.assertNotIn("write_file", names)
        self.assertNotIn("edit_file", names)

    def test_multi_tool_parallel_runs_and_keeps_input_order(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            with open(os.path.join(td, "a.txt"), "w", encoding="utf-8") as f:
                f.write("hello\n")
            out = json.loads(
                shared_tools.execute_builtin_tool(
                    "multi_tool_use_parallel",
                    {
                        "tool_uses": [
                            {"recipient_name": "functions.read_file", "parameters": {"path": "a.txt"}},
                            {"recipient_name": "functions.exec_command", "parameters": {"cmd": "echo ok"}},
                        ]
                    },
                    workspace_dir=td,
                )
            )
            self.assertTrue(bool(out.get("ok")))
            results = out.get("results") if isinstance(out.get("results"), list) else []
            self.assertEqual(len(results), 2)
            self.assertEqual(int((results[0] or {}).get("index", -1)), 0)
            self.assertEqual(int((results[1] or {}).get("index", -1)), 1)
            self.assertEqual(str((results[0] or {}).get("toolName") or ""), "read_file")
            self.assertEqual(str((results[1] or {}).get("toolName") or ""), "bash")
            self.assertTrue(bool((results[0] or {}).get("ok")))
            self.assertTrue(bool((results[1] or {}).get("ok")))

    def test_multi_tool_parallel_rejects_disallowed_tool(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            out = json.loads(
                shared_tools.execute_builtin_tool(
                    "multi_tool_use_parallel",
                    {
                        "tool_uses": [
                            {"recipient_name": "functions.spawn_agent", "parameters": {"message": "x"}},
                        ]
                    },
                    workspace_dir=td,
                )
            )
            self.assertFalse(bool(out.get("ok")))
            results = out.get("results") if isinstance(out.get("results"), list) else []
            self.assertEqual(len(results), 1)
            self.assertFalse(bool((results[0] or {}).get("ok")))
            self.assertIn("tool not allowed", str((results[0] or {}).get("error") or ""))

    def test_system_prompt_includes_write_rule(self) -> None:
        from anima_backend_core.runtime.graph import build_system_prompt_text

        settings_obj = {"settings": {}}
        prompt = build_system_prompt_text(settings_obj, {}, "帮我写文件")
        self.assertIn("apply_patch", prompt)
        self.assertIn("使用 apply_patch 编辑文件前，必须先读取目标文件的当前完整内容", prompt)
        self.assertIn("如果读取结果被截断", prompt)
        self.assertIn("遇到 apply_patch 返回 CONFLICT", prompt)

    def test_memory_add_blocked_without_evidence_when_policy_enabled(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": True,
                        "memoryWriteMinImportance": 0.5,
                        "memoryWriteMinConfidence": 0.6,
                    }
                },
            ):
                out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {
                            "content": "用户喜欢长跑",
                            "type": "semantic",
                            "importance": 0.9,
                            "confidence": 0.9,
                        },
                        workspace_dir=td,
                    )
                )
        self.assertFalse(bool(out.get("ok")))
        self.assertTrue(bool(out.get("blocked")))
        self.assertEqual(str(out.get("reason") or ""), "evidence_required")

    def test_memory_add_and_query_roundtrip(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": True,
                        "memoryWriteMinImportance": 0.5,
                        "memoryWriteMinConfidence": 0.6,
                        "memoryMaxRetrieveCount": 8,
                        "memorySimilarityThreshold": 0.0,
                    }
                },
            ):
                add_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {
                            "content": "用户偏好中文回复",
                            "type": "semantic",
                            "importance": 0.8,
                            "confidence": 0.9,
                            "evidence": ["用户在本会话中明确提出"],
                            "source": "agent",
                            "runId": "r100",
                            "userId": "u100",
                        },
                        workspace_dir=td,
                    )
                )
                self.assertTrue(bool(add_out.get("ok")))
                query_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_query",
                        {"query": "请用中文回答", "topK": 3, "threshold": 0.0},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(query_out.get("ok")))
        items = query_out.get("items") if isinstance(query_out.get("items"), list) else []
        self.assertTrue(any("用户偏好中文回复" in str(x.get("content") or "") for x in items if isinstance(x, dict)))

    def test_memory_consolidate_promotes_high_value_memory(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memoryConsolidateMinImportance": 0.75,
                        "memoryConsolidateMinConfidence": 0.75,
                        "memoryMaxRetrieveCount": 8,
                        "memorySimilarityThreshold": 0.0,
                    }
                },
            ):
                shared_tools.execute_builtin_tool(
                    "memory_add",
                    {
                        "content": "用户每周日晨跑",
                        "type": "episodic",
                        "importance": 0.9,
                        "confidence": 0.9,
                    },
                    workspace_dir=td,
                )
                c_out = json.loads(shared_tools.execute_builtin_tool("memory_consolidate", {}, workspace_dir=td))
                self.assertTrue(bool(c_out.get("ok")))
                q_out = json.loads(shared_tools.execute_builtin_tool("memory_query", {"query": "晨跑", "threshold": 0.0}, workspace_dir=td))
        items = q_out.get("items") if isinstance(q_out.get("items"), list) else []
        self.assertTrue(any(str(x.get("type") or "") == "semantic" for x in items if isinstance(x, dict)))

    def test_memory_forget_hides_items_from_query(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memoryMaxRetrieveCount": 8,
                        "memorySimilarityThreshold": 0.0,
                    }
                },
            ):
                add_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户怕冷", "type": "semantic", "importance": 0.8, "confidence": 0.8},
                        workspace_dir=td,
                    )
                )
                mid = str((((add_out.get("item") or {}) if isinstance(add_out, dict) else {}).get("id") or "")).strip()
                self.assertTrue(bool(mid))
                f_out = json.loads(shared_tools.execute_builtin_tool("memory_forget", {"ids": [mid]}, workspace_dir=td))
                self.assertTrue(bool(f_out.get("ok")))
                q_out = json.loads(shared_tools.execute_builtin_tool("memory_query", {"query": "怕冷", "threshold": 0.0}, workspace_dir=td))
        items = q_out.get("items") if isinstance(q_out.get("items"), list) else []
        self.assertFalse(any(str(x.get("id") or "") == mid for x in items if isinstance(x, dict)))

    def test_memory_link_and_graph_query_roundtrip(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={"settings": {"memoryWriteRequireEvidence": False, "memorySimilarityThreshold": 0.0}},
            ):
                a = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户家在上海", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
                b = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户通勤到浦东", "type": "episodic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
                aid = str((((a.get("item") or {}) if isinstance(a, dict) else {}).get("id") or "")).strip()
                bid = str((((b.get("item") or {}) if isinstance(b, dict) else {}).get("id") or "")).strip()
                self.assertTrue(aid and bid)
                l = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_link",
                        {"fromId": aid, "toId": bid, "relation": "related_to", "weight": 0.8},
                        workspace_dir=td,
                    )
                )
                self.assertTrue(bool(l.get("ok")))
                g = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_graph_query",
                        {"anchorIds": [aid], "hops": 1, "maxNodes": 10},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(g.get("ok")))
        result = g.get("result") if isinstance(g.get("result"), dict) else {}
        nodes = result.get("nodes") if isinstance(result.get("nodes"), list) else []
        self.assertTrue(any("浦东" in str(n.get("content") or "") for n in nodes if isinstance(n, dict)))

    def test_memory_add_conflict_supersedes_previous_semantic(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(settings, "load_settings", return_value={"settings": {"memoryWriteRequireEvidence": False}}):
                a1 = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户喜欢咖啡", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
                a2 = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户喜欢咖啡。", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
                superseded = ((a2.get("item") or {}) if isinstance(a2, dict) else {}).get("supersededIds") or []
                self.assertTrue(bool(a1.get("ok")))
                self.assertTrue(bool(a2.get("ok")))
                self.assertTrue(isinstance(superseded, list) and len(superseded) >= 1)

    def test_memory_metrics_tool_returns_event_summary(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={"settings": {"memoryWriteRequireEvidence": False, "memorySimilarityThreshold": 0.0}},
            ):
                shared_tools.execute_builtin_tool(
                    "memory_add",
                    {"content": "用户习惯晨跑", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                    workspace_dir=td,
                )
                shared_tools.execute_builtin_tool(
                    "memory_query",
                    {"query": "晨跑", "threshold": 0.0},
                    workspace_dir=td,
                )
                out = json.loads(shared_tools.execute_builtin_tool("memory_metrics", {"days": 7}, workspace_dir=td))
        self.assertTrue(bool(out.get("ok")))
        result = out.get("result") if isinstance(out.get("result"), dict) else {}
        events = result.get("events") if isinstance(result.get("events"), list) else []
        names = [str(x.get("event") or "") for x in events if isinstance(x, dict)]
        self.assertTrue("add" in names and "query" in names)

    def test_memory_add_global_and_query_from_workspace(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memorySimilarityThreshold": 0.0,
                        "memoryMaxRetrieveCount": 8,
                        "memoryGlobalEnabled": True,
                        "memoryGlobalWriteEnabled": True,
                        "memoryGlobalRetrieveCount": 3,
                    }
                },
            ):
                add_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户喜欢结构化代码评审", "scope": "global", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir="",
                    )
                )
                self.assertTrue(bool(add_out.get("ok")))
                q_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_query",
                        {"query": "代码评审偏好", "includeGlobal": True, "threshold": 0.0},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(q_out.get("ok")))
        items = q_out.get("items") if isinstance(q_out.get("items"), list) else []
        self.assertTrue(any(str(x.get("scope") or "") == "global" for x in items if isinstance(x, dict)))

    def test_memory_add_auto_scope_decides_global_for_user_preference(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memoryScopeAutoEnabled": True,
                        "memoryDefaultWriteScope": "workspace",
                        "memoryGlobalEnabled": True,
                        "memoryGlobalWriteEnabled": True,
                    }
                },
            ):
                add_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "用户偏好中文回复", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(add_out.get("ok")))
        item = add_out.get("item") if isinstance(add_out.get("item"), dict) else {}
        self.assertEqual(str(item.get("scope") or ""), "global")
        dec = add_out.get("scopeDecision") if isinstance(add_out.get("scopeDecision"), dict) else {}
        self.assertEqual(str(dec.get("scope") or ""), "global")

    def test_memory_add_auto_scope_decides_workspace_for_project_context(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memoryScopeAutoEnabled": True,
                        "memoryDefaultWriteScope": "workspace",
                        "memoryGlobalEnabled": True,
                        "memoryGlobalWriteEnabled": True,
                    }
                },
            ):
                add_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_add",
                        {"content": "当前项目 src/api/user.ts 接口返回要兼容旧字段", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(add_out.get("ok")))
        item = add_out.get("item") if isinstance(add_out.get("item"), dict) else {}
        self.assertEqual(str(item.get("scope") or ""), "workspace")

    def test_memory_query_global_without_workspace_when_enabled(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with patch.object(
            settings,
            "load_settings",
            return_value={
                "settings": {
                    "memoryWriteRequireEvidence": False,
                    "memorySimilarityThreshold": 0.0,
                    "memoryMaxRetrieveCount": 8,
                    "memoryGlobalEnabled": True,
                    "memoryGlobalWriteEnabled": True,
                    "memoryGlobalRetrieveCount": 3,
                }
            },
        ):
            shared_tools.execute_builtin_tool(
                "memory_add",
                {"content": "用户要求结论先行", "scope": "global", "type": "semantic", "importance": 0.8, "confidence": 0.8},
                workspace_dir="",
            )
            q_out = json.loads(
                shared_tools.execute_builtin_tool(
                    "memory_query",
                    {"query": "结论先行", "includeGlobal": True, "threshold": 0.0},
                    workspace_dir="",
                )
            )
        self.assertTrue(bool(q_out.get("ok")))
        items = q_out.get("items") if isinstance(q_out.get("items"), list) else []
        self.assertTrue(any("结论先行" in str(x.get("content") or "") for x in items if isinstance(x, dict)))

    def test_memory_query_prefers_workspace_when_conflict_like_duplicate(self) -> None:
        import anima_backend_shared.tools as shared_tools
        import anima_backend_shared.settings as settings

        with tempfile.TemporaryDirectory() as td:
            with patch.object(
                settings,
                "load_settings",
                return_value={
                    "settings": {
                        "memoryWriteRequireEvidence": False,
                        "memorySimilarityThreshold": 0.0,
                        "memoryMaxRetrieveCount": 8,
                        "memoryGlobalEnabled": True,
                        "memoryGlobalWriteEnabled": True,
                        "memoryGlobalRetrieveCount": 5,
                    }
                },
            ):
                shared_tools.execute_builtin_tool(
                    "memory_add",
                    {"content": "用户喜欢中文回复", "scope": "global", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                    workspace_dir="",
                )
                shared_tools.execute_builtin_tool(
                    "memory_add",
                    {"content": "用户偏好中文回复", "scope": "workspace", "type": "semantic", "importance": 0.9, "confidence": 0.9},
                    workspace_dir=td,
                )
                q_out = json.loads(
                    shared_tools.execute_builtin_tool(
                        "memory_query",
                        {"query": "请使用中文回答", "includeGlobal": True, "topK": 5, "threshold": 0.0},
                        workspace_dir=td,
                    )
                )
        self.assertTrue(bool(q_out.get("ok")))
        items = q_out.get("items") if isinstance(q_out.get("items"), list) else []
        workspace_hits = [x for x in items if isinstance(x, dict) and str(x.get("scope") or "") == "workspace"]
        global_hits = [x for x in items if isinstance(x, dict) and str(x.get("scope") or "") == "global"]
        self.assertTrue(len(workspace_hits) >= 1)
        self.assertFalse(any("中文回复" in str(x.get("content") or "") for x in global_hits))

    def test_apply_patch_update_and_move_file(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "src.txt")
            with open(src, "w", encoding="utf-8") as f:
                f.write("hello\nworld")

            patch_text = "\n".join(
                [
                    "*** Begin Patch",
                    "*** Update File: src.txt",
                    "*** Move to: dst.txt",
                    "@@",
                    "-hello",
                    "+hi",
                    " world",
                    "*** End Patch",
                ]
            )
            out = json.loads(shared_tools.execute_builtin_tool("apply_patch", {"patch": patch_text}, workspace_dir=td))
            self.assertTrue(bool(out.get("ok")))
            self.assertTrue(bool(out.get("changed")))
            self.assertTrue(os.path.isfile(os.path.join(td, "dst.txt")))
            self.assertFalse(os.path.exists(os.path.join(td, "src.txt")))
            with open(os.path.join(td, "dst.txt"), "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), "hi\nworld")

    def test_apply_patch_conflict_keeps_files_unchanged(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            a = os.path.join(td, "a.txt")
            with open(a, "w", encoding="utf-8") as f:
                f.write("one")

            patch_text = "\n".join(
                [
                    "*** Begin Patch",
                    "*** Update File: a.txt",
                    "@@",
                    "-one",
                    "+ONE",
                    "*** Update File: missing.txt",
                    "@@",
                    "-x",
                    "+y",
                    "*** End Patch",
                ]
            )
            with self.assertRaises(RuntimeError) as ex:
                shared_tools.execute_builtin_tool("apply_patch", {"patch": patch_text}, workspace_dir=td)
            self.assertIn("CONFLICT", str(ex.exception))
            with open(a, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), "one")

    def test_apply_patch_accepts_common_marker_variants(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            patch_text = "\n".join(
                [
                    "*** Begin Patch ***",
                    "Add File: poem.txt",
                    "+line 1",
                    "+line 2",
                    "*** End Patch ***",
                ]
            )
            out = json.loads(shared_tools.execute_builtin_tool("apply_patch", {"patch": patch_text}, workspace_dir=td))
            self.assertTrue(bool(out.get("ok")))
            fp = os.path.join(td, "poem.txt")
            self.assertTrue(os.path.isfile(fp))
            with open(fp, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), "line 1\nline 2")

    def test_bash_default_mode_requires_approval_for_blacklist(self) -> None:
        import anima_backend_shared.tools as shared_tools

        cmd = "rm -rf ./tmpdir"
        with tempfile.TemporaryDirectory() as td:
            with patch(
                "anima_backend_shared.settings.load_settings",
                return_value={
                    "settings": {
                        "commandBlacklist": ["rm"],
                        "commandWhitelist": [],
                    }
                },
            ):
                with self.assertRaises(RuntimeError) as ex:
                    shared_tools.execute_builtin_tool(
                        "bash",
                        {
                            "command": cmd,
                            "_animaPermissionMode": "workspace_whitelist",
                        },
                        workspace_dir=td,
                    )
                msg = str(ex.exception)
                self.assertTrue(msg.startswith("ANIMA_DANGEROUS_COMMAND_APPROVAL:"))
                payload = json.loads(msg.split(":", 1)[1])
                self.assertEqual(str(payload.get("command") or ""), cmd)

                with patch.object(
                    shared_tools,
                    "run_bash_with_os_sandbox",
                    return_value={
                        "ok": True,
                        "exitCode": 0,
                        "stdout": "ok\n",
                        "stderr": "",
                        "truncated": {"stdout": False, "stderr": False},
                        "cwd": td,
                        "sandbox": {"enabled": True, "kind": "macos_sandbox_exec", "reason": "permission_mode_workspace_whitelist"},
                    },
                ) as p_run:
                    out = json.loads(
                        shared_tools.execute_builtin_tool(
                            "bash",
                            {
                                "command": cmd,
                                "_animaPermissionMode": "workspace_whitelist",
                                "_animaDangerousCommandApprovals": [cmd],
                            },
                            workspace_dir=td,
                        )
                    )
                    self.assertTrue(bool(out.get("ok")))
                    self.assertEqual(int(out.get("exitCode")) if out.get("exitCode") is not None else -1, 0)
                    self.assertTrue(p_run.called)

    def test_bash_default_mode_allow_for_thread_bypasses_blacklist(self) -> None:
        import anima_backend_shared.tools as shared_tools

        cmd = "rm -rf ./tmpdir"
        with tempfile.TemporaryDirectory() as td:
            with patch(
                "anima_backend_shared.settings.load_settings",
                return_value={
                    "settings": {
                        "commandBlacklist": ["rm"],
                        "commandWhitelist": [],
                    }
                },
            ):
                with patch.object(
                    shared_tools,
                    "run_bash_with_os_sandbox",
                    return_value={
                        "ok": True,
                        "exitCode": 0,
                        "stdout": "ok\n",
                        "stderr": "",
                        "truncated": {"stdout": False, "stderr": False},
                        "cwd": td,
                        "sandbox": {"enabled": True, "kind": "macos_sandbox_exec", "reason": "permission_mode_workspace_whitelist"},
                    },
                ) as p_run:
                    out = json.loads(
                        shared_tools.execute_builtin_tool(
                            "bash",
                            {
                                "command": cmd,
                                "_animaPermissionMode": "workspace_whitelist",
                                "_animaDangerousCommandAllowForThread": True,
                            },
                            workspace_dir=td,
                        )
                    )
                    self.assertTrue(bool(out.get("ok")))
                    self.assertEqual(int(out.get("exitCode")) if out.get("exitCode") is not None else -1, 0)
                    self.assertTrue(p_run.called)

    def test_bash_default_mode_requires_approval_for_blacklist_in_compound_command(self) -> None:
        import anima_backend_shared.tools as shared_tools

        cmd = "pwd && rm -rf ./tmpdir"
        with tempfile.TemporaryDirectory() as td:
            with patch(
                "anima_backend_shared.settings.load_settings",
                return_value={
                    "settings": {
                        "commandBlacklist": ["rm"],
                        "commandWhitelist": [],
                    }
                },
            ):
                with self.assertRaises(RuntimeError) as ex:
                    shared_tools.execute_builtin_tool(
                        "bash",
                        {
                            "command": cmd,
                            "_animaPermissionMode": "workspace_whitelist",
                        },
                        workspace_dir=td,
                    )
                msg = str(ex.exception)
                self.assertTrue(msg.startswith("ANIMA_DANGEROUS_COMMAND_APPROVAL:"))
                payload = json.loads(msg.split(":", 1)[1])
                self.assertEqual(str(payload.get("command") or ""), cmd)
                self.assertEqual(str(payload.get("matchedPattern") or ""), "rm")

    def test_coder_tool_payload_success_keeps_minimum_fields(self) -> None:
        import anima_backend_shared.tools as shared_tools

        out = shared_tools._build_coder_tool_payload(
            {
                "ok": True,
                "exitCode": 0,
                "provider": "codex",
                "profileId": "coder-default",
                "summary": "done",
                "artifacts": [{"kind": "file", "path": "/tmp/a.txt"}],
                "needsDecision": False,
                "decisionRequests": [],
                "raw": {"stdout": "hello\n", "stderr": ""},
            }
        )
        self.assertEqual(bool(out.get("ok")), True)
        self.assertEqual(int(out.get("exitCode")) if out.get("exitCode") is not None else -1, 0)
        self.assertEqual(str(out.get("stdout") or ""), "hello\n")
        self.assertTrue(isinstance(out.get("artifacts"), list))
        self.assertNotIn("stderr", out)
        self.assertNotIn("provider", out)
        self.assertNotIn("profileId", out)
        self.assertNotIn("summary", out)

    def test_coder_tool_payload_failure_includes_stderr_and_decision(self) -> None:
        import anima_backend_shared.tools as shared_tools

        out = shared_tools._build_coder_tool_payload(
            {
                "ok": False,
                "exitCode": 2,
                "needsDecision": True,
                "decisionRequests": [{"type": "approval", "command": "rm -rf ."}],
                "raw": {"stdout": "", "stderr": "failed\n"},
            }
        )
        self.assertEqual(bool(out.get("ok")), False)
        self.assertEqual(int(out.get("exitCode")) if out.get("exitCode") is not None else -1, 2)
        self.assertEqual(str(out.get("stderr") or ""), "failed\n")
        self.assertEqual(bool(out.get("needsDecision")), True)
        self.assertTrue(isinstance(out.get("decisionRequests"), list))

    def test_read_file_workspace_whitelist_blocks_symlink_escape(self) -> None:
        import anima_backend_shared.tools as shared_tools

        if not hasattr(os, "symlink"):
            self.skipTest("os.symlink is not supported")

        with tempfile.TemporaryDirectory() as td:
            workspace = os.path.join(td, "workspace")
            outside = os.path.join(td, "outside")
            os.makedirs(workspace, exist_ok=True)
            os.makedirs(outside, exist_ok=True)
            with open(os.path.join(outside, "secret.txt"), "w", encoding="utf-8") as f:
                f.write("secret")
            os.symlink(outside, os.path.join(workspace, "link-out"))

            with self.assertRaises(RuntimeError) as ex:
                shared_tools.execute_builtin_tool(
                    "read_file",
                    {"path": "link-out/secret.txt", "_animaPermissionMode": "workspace_whitelist"},
                    workspace_dir=workspace,
                )
            self.assertEqual(str(ex.exception), "Path outside workspace")

    def test_list_dir_workspace_whitelist_blocks_symlink_escape(self) -> None:
        import anima_backend_shared.tools as shared_tools

        if not hasattr(os, "symlink"):
            self.skipTest("os.symlink is not supported")

        with tempfile.TemporaryDirectory() as td:
            workspace = os.path.join(td, "workspace")
            outside = os.path.join(td, "outside")
            os.makedirs(workspace, exist_ok=True)
            os.makedirs(outside, exist_ok=True)
            os.symlink(outside, os.path.join(workspace, "link-out"))

            with self.assertRaises(RuntimeError) as ex:
                shared_tools.execute_builtin_tool(
                    "list_dir",
                    {"path": "link-out", "_animaPermissionMode": "workspace_whitelist"},
                    workspace_dir=workspace,
                )
            self.assertEqual(str(ex.exception), "Path outside workspace")

    def test_bash_workspace_whitelist_blocks_symlink_escape_cwd(self) -> None:
        import anima_backend_shared.tools as shared_tools

        if not hasattr(os, "symlink"):
            self.skipTest("os.symlink is not supported")

        with tempfile.TemporaryDirectory() as td:
            workspace = os.path.join(td, "workspace")
            outside = os.path.join(td, "outside")
            os.makedirs(workspace, exist_ok=True)
            os.makedirs(outside, exist_ok=True)
            os.symlink(outside, os.path.join(workspace, "link-out"))

            with self.assertRaises(RuntimeError) as ex:
                shared_tools.execute_builtin_tool(
                    "bash",
                    {
                        "command": "pwd",
                        "cwd": "link-out",
                        "_animaPermissionMode": "workspace_whitelist",
                    },
                    workspace_dir=workspace,
                )
            self.assertEqual(str(ex.exception), "cwd outside allowed directory")

    def test_read_file_workspace_whitelist_allows_additional_workspace_roots(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            workspace_main = os.path.join(td, "workspace-main")
            workspace_extra = os.path.join(td, "workspace-extra")
            os.makedirs(workspace_main, exist_ok=True)
            os.makedirs(workspace_extra, exist_ok=True)
            target = os.path.join(workspace_extra, "hello.txt")
            with open(target, "w", encoding="utf-8") as f:
                f.write("hello")

            out = shared_tools.execute_builtin_tool(
                "read_file",
                {
                    "path": target,
                    "_animaPermissionMode": "workspace_whitelist",
                    "_animaWorkspaceRoots": [workspace_extra],
                },
                workspace_dir=workspace_main,
            )
            obj = json.loads(out)
            self.assertEqual(str((obj.get("text") or "").strip()), "hello")

    def test_list_dir_full_access_without_workspace_uses_home_dir(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "docs"), exist_ok=True)
            with patch("anima_backend_shared.tools.Path.home", return_value=shared_tools.Path(td)):
                out = shared_tools.execute_builtin_tool(
                    "list_dir",
                    {"path": "", "_animaPermissionMode": "full_access"},
                    workspace_dir="",
                )
            obj = json.loads(out)
            entries = obj.get("entries") if isinstance(obj.get("entries"), list) else []
            names = [str((x or {}).get("name") or "") for x in entries if isinstance(x, dict)]
            self.assertIn("docs", names)

    def test_read_file_full_access_without_workspace_uses_home_dir(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            target = os.path.join(td, "note.txt")
            with open(target, "w", encoding="utf-8") as f:
                f.write("hello-full-access")
            with patch("anima_backend_shared.tools.Path.home", return_value=shared_tools.Path(td)):
                out = shared_tools.execute_builtin_tool(
                    "read_file",
                    {"path": "note.txt", "_animaPermissionMode": "full_access"},
                    workspace_dir="",
                )
            obj = json.loads(out)
            self.assertEqual(str((obj.get("text") or "").strip()), "hello-full-access")

    def test_bash_workspace_whitelist_passes_additional_workspace_roots_to_sandbox(self) -> None:
        import anima_backend_shared.tools as shared_tools

        with tempfile.TemporaryDirectory() as td:
            workspace_main = os.path.join(td, "workspace-main")
            workspace_extra = os.path.join(td, "workspace-extra")
            os.makedirs(workspace_main, exist_ok=True)
            os.makedirs(workspace_extra, exist_ok=True)

            with patch(
                "anima_backend_shared.tools.run_bash_with_os_sandbox",
                return_value={"ok": True, "exitCode": 0, "stdout": "", "stderr": "", "truncated": {}, "cwd": workspace_extra, "sandbox": {}},
            ) as run_mock:
                shared_tools.execute_builtin_tool(
                    "bash",
                    {
                        "command": "pwd",
                        "cwd": workspace_extra,
                        "_animaPermissionMode": "workspace_whitelist",
                        "_animaWorkspaceRoots": [workspace_extra],
                    },
                    workspace_dir=workspace_main,
                )

            kwargs = run_mock.call_args.kwargs if run_mock.call_args else {}
            allowed_roots = kwargs.get("allowed_roots") if isinstance(kwargs.get("allowed_roots"), list) else []
            norm_allowed = {os.path.realpath(str(x)) for x in allowed_roots}
            self.assertIn(os.path.realpath(workspace_extra), norm_allowed)

if __name__ == "__main__":
    unittest.main()
