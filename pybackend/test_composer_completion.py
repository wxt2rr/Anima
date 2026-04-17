import json
import unittest
from unittest.mock import patch


class _WFile:
    def __init__(self) -> None:
        self.buf = b""

    def write(self, b: bytes) -> None:
        self.buf += b

    def flush(self) -> None:
        return


class _Handler:
    def __init__(self, body_obj=None, *, query=None):
        body_bytes = b""
        if body_obj is not None:
            body_bytes = json.dumps(body_obj).encode("utf-8")
        self._body = body_bytes
        self.headers = {"Content-Length": str(len(body_bytes))}
        self.wfile = _WFile()
        self.query = query or {}
        self._code = 0

    def send_response(self, code) -> None:
        self._code = int(code)

    def send_header(self, _k, _v) -> None:
        return

    def end_headers(self) -> None:
        return

    def _read(self) -> bytes:
        return self._body


class ComposerCompletionApiTests(unittest.TestCase):
    def _dispatch(self, method: str, path: str, body_obj=None, *, query=None):
        from anima_backend_core.api import dispatch

        h = _Handler(body_obj=body_obj, query=query)
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h._read()})()
        ok = dispatch(h, method, path)
        self.assertTrue(ok)
        raw = h.wfile.buf.decode("utf-8")
        out = json.loads(raw) if raw.strip() else {}
        return h._code, out

    def test_tab_complete_returns_complete_text(self) -> None:
        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": "ppy"}}]},
            ),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {"input": "i am ha", "composer": {"completionEnabled": True}},
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("mode") or ""), "complete")
        self.assertEqual(str(out.get("text") or ""), "ppy")
        self.assertEqual(str(out.get("raw") or ""), "ppy")
        self.assertTrue(bool(out.get("applied")))

    def test_tab_complete_disabled_short_circuit(self) -> None:
        with patch("anima_backend_core.api.composer.call_chat_completion") as call_mock:
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {"input": "i am ha", "composer": {"completionEnabled": False}},
            )
        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("mode") or ""), "complete")
        self.assertEqual(str(out.get("text") or ""), "")
        self.assertEqual(str(out.get("raw") or ""), "")
        self.assertEqual(str(out.get("skipped") or ""), "disabled")
        call_mock.assert_not_called()

    def test_tab_complete_uses_completion_model_override_from_settings(self) -> None:
        with (
            patch(
                "anima_backend_core.api.composer.load_settings",
                return_value={"settings": {"tabCompletionProviderId": "provider_tab", "tabCompletionModelId": "model_tab"}},
            ),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()) as create_provider_mock,
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": ""}}]},
            ) as call_mock,
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "i am ha",
                    "composer": {"modelOverride": "chat_model", "completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        create_provider_mock.assert_called_once()
        create_provider_args, _ = create_provider_mock.call_args
        self.assertEqual(str(create_provider_args[1].get("providerOverrideId") or ""), "provider_tab")
        call_mock.assert_called_once()
        _, call_kwargs = call_mock.call_args
        self.assertEqual(str(call_kwargs.get("model_override") or ""), "model_tab")

    def test_tab_complete_with_completion_provider_but_no_model_uses_provider_default(self) -> None:
        with (
            patch(
                "anima_backend_core.api.composer.load_settings",
                return_value={"settings": {"tabCompletionProviderId": "provider_tab", "tabCompletionModelId": ""}},
            ),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()) as create_provider_mock,
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": ""}}]},
            ) as call_mock,
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "i am ha",
                    "composer": {"modelOverride": "chat_model", "completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        create_provider_mock.assert_called_once()
        create_provider_args, _ = create_provider_mock.call_args
        self.assertEqual(str(create_provider_args[1].get("providerOverrideId") or ""), "provider_tab")
        call_mock.assert_called_once()
        _, call_kwargs = call_mock.call_args
        self.assertIsNone(call_kwargs.get("model_override"))

    def test_tab_complete_mode_translate_returns_rewrite_text(self) -> None:
        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": "I am happy"}}]},
            ),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "I am 快乐",
                    "tabMode": "translate",
                    "composer": {"completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("mode") or ""), "translate")
        self.assertEqual(str(out.get("text") or ""), "I am happy")

    def test_tab_complete_complete_mode_accepts_legacy_json_text_payload(self) -> None:
        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": '{"action":"append","text":"ppy"}'}}]},
            ),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {"input": "i am ha", "composer": {"completionEnabled": True}},
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("text") or ""), "ppy")

    def test_tab_complete_complete_mode_extracts_suffix_from_full_sentence(self) -> None:
        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": "i am happy"}}]},
            ),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {"input": "i am ", "composer": {"completionEnabled": True}},
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("text") or ""), "happy")

    def test_tab_complete_default_context_uses_recent_4_user_assistant_only(self) -> None:
        captured = {}

        def _fake_completion(*args, **kwargs):
            captured["messages"] = args[1] if len(args) > 1 else kwargs.get("messages")
            return {"choices": [{"message": {"content": "ppy"}}]}

        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch(
                "anima_backend_core.api.composer.get_chat",
                return_value={
                    "messages": [
                        {"role": "system", "content": "s0"},
                        {"role": "user", "content": "u1"},
                        {"role": "assistant", "content": "a1"},
                        {"role": "tool", "content": "t1"},
                        {"role": "user", "content": "u2"},
                        {"role": "assistant", "content": "a2"},
                        {"role": "user", "content": "u3"},
                        {"role": "assistant", "content": "a3"},
                        {"role": "agent", "content": "ag4"},
                        {"role": "user", "content": "u4"},
                    ]
                },
            ),
            patch("anima_backend_core.api.composer.call_chat_completion", side_effect=_fake_completion),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "i am ",
                    "composer": {"chatId": "chat_ctx", "completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        messages = captured.get("messages") or []
        self.assertTrue(len(messages) >= 2)
        final_user = str(messages[-1].get("content") or "")
        self.assertIn("mode: complete", final_user)
        self.assertIn("current_segment: i am", final_user)
        self.assertIn("context_before: user: u3 | assistant: a3 | assistant: ag4 | user: u4", final_user)

    def test_tab_complete_context_limit_from_composer(self) -> None:
        captured = {}

        def _fake_completion(*args, **kwargs):
            captured["messages"] = args[1] if len(args) > 1 else kwargs.get("messages")
            return {"choices": [{"message": {"content": "ppy"}}]}

        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch(
                "anima_backend_core.api.composer.get_chat",
                return_value={
                    "messages": [
                        {"role": "user", "content": "u1"},
                        {"role": "assistant", "content": "a1"},
                        {"role": "user", "content": "u2"},
                        {"role": "assistant", "content": "a2"},
                        {"role": "user", "content": "u3"},
                    ]
                },
            ),
            patch("anima_backend_core.api.composer.call_chat_completion", side_effect=_fake_completion),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "i am ",
                    "composer": {
                        "chatId": "chat_ctx",
                        "completionEnabled": True,
                        "completionContextLimit": 2,
                    },
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        messages = captured.get("messages") or []
        self.assertTrue(len(messages) >= 2)
        final_user = str(messages[-1].get("content") or "")
        self.assertIn("context_before: assistant: a2 | user: u3", final_user)

    def test_tab_complete_mode_translate_injected_from_tab_mode(self) -> None:
        captured = {}

        def _fake_completion(*args, **kwargs):
            captured["messages"] = args[1] if len(args) > 1 else kwargs.get("messages")
            return {"choices": [{"message": {"content": "I am happy"}}]}

        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch("anima_backend_core.api.composer.call_chat_completion", side_effect=_fake_completion),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "I am 快乐",
                    "tabMode": "translate",
                    "composer": {"completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        messages = captured.get("messages") or []
        self.assertTrue(len(messages) >= 2)
        final_user = str(messages[-1].get("content") or "")
        self.assertIn("mode: translate", final_user)

    def test_tab_complete_spell_suggest_returns_candidates(self) -> None:
        with (
            patch("anima_backend_core.api.composer.load_settings", return_value={"settings": {}}),
            patch("anima_backend_core.api.composer.create_provider", return_value=object()),
            patch("anima_backend_core.api.composer.get_chat", return_value={"messages": []}),
            patch(
                "anima_backend_core.api.composer.call_chat_completion",
                return_value={"choices": [{"message": {"content": '{"candidates":["example","sample","explain"]}'}}]},
            ),
        ):
            code, out = self._dispatch(
                "POST",
                "/api/composer/tab_complete",
                {
                    "input": "can you show me the exeplce",
                    "word": "exeplce",
                    "tabMode": "spell_suggest",
                    "composer": {"completionEnabled": True},
                },
            )

        self.assertEqual(code, 200)
        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(str(out.get("mode") or ""), "spell_suggest")
        self.assertEqual(str(out.get("text") or ""), "example")
        self.assertEqual(out.get("candidates"), ["example", "sample", "explain"])

    def test_tab_complete_requires_input(self) -> None:
        code, out = self._dispatch("POST", "/api/composer/tab_complete", {"input": "  "})
        self.assertEqual(code, 400)
        self.assertFalse(bool(out.get("ok")))


if __name__ == "__main__":
    unittest.main()
