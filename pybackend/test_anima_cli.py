from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from anima_backend_shared import database, settings
from anima_backend_shared.database import init_db, set_app_settings
from anima_cli.main import main as anima_main


def _base_settings(workspace_dir: str) -> dict:
    return {
        "settings": {
            "workspaceDir": workspace_dir,
            "language": "zh",
            "theme": "system",
            "themeColor": "zinc",
            "density": "comfortable",
            "enableStreamingResponse": False,
            "showTokenUsage": False,
            "enableMarkdown": True,
            "collapseHistoricalProcess": True,
            "temperature": 0.7,
            "maxTokens": 4096,
            "enableAutoCompression": True,
            "compressionThreshold": 20,
            "keepRecentMessages": 4,
            "memoryEnabled": False,
            "memoryRetrievalEnabled": True,
            "memoryMaxRetrieveCount": 6,
            "memorySimilarityThreshold": 0.6,
            "memoryAutoSummarizeEnabled": False,
            "memoryToolModelId": "",
            "memoryEmbeddingModelId": "",
            "voice": {"enabled": False, "model": "", "language": "auto", "autoDetect": True},
            "defaultSkillMode": "auto",
            "im": {"telegram": {"enabled": False, "allowGroups": False}},
            "shortcuts": {"bindings": {}},
            "proxyUrl": "",
            "coder": {
                "enabled": False,
                "name": "Codex",
                "backendKind": "codex",
                "backendLabel": "",
                "endpointType": "desktop",
                "transport": "cdpbridge",
                "autoStart": False,
                "command": "/usr/bin/open",
                "args": ["-a", "Codex", "--args", "--remote-debugging-port=9222"],
                "cwd": "",
                "env": {},
                "remoteDebuggingPort": 9222,
            },
        },
        "providers": [],
    }


class TestAnimaCli(unittest.TestCase):
    def setUp(self) -> None:
        self.td = tempfile.TemporaryDirectory()
        os.environ["ANIMA_CONFIG_ROOT"] = self.td.name
        database._CONFIG_ROOT = None
        settings._CONFIG_ROOT = None
        database._DB_INITIALIZED = False
        init_db()
        set_app_settings(_base_settings(self.td.name))

    def tearDown(self) -> None:
        database.close_db_connection()
        if "ANIMA_CONFIG_ROOT" in os.environ:
            del os.environ["ANIMA_CONFIG_ROOT"]
        self.td.cleanup()

    def _run(self, argv: list[str]) -> tuple[int, dict]:
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = anima_main(argv)
        raw = buf.getvalue().strip()
        payload = json.loads(raw) if raw else {}
        return code, payload

    def test_group_help_registry(self) -> None:
        code, payload = self._run(["schema", "--json"])
        self.assertEqual(code, 0)
        self.assertTrue(payload.get("ok"))
        self.assertIn("chat", payload.get("groups", {}))
        self.assertIn("status_center", payload.get("groups", {}))

    def test_chat_stream_project_set_and_get(self) -> None:
        code1, out1 = self._run(["chat", "set", "stream", "on", "--json"])
        self.assertEqual(code1, 0)
        self.assertTrue(out1.get("ok"))
        code2, out2 = self._run(["chat", "get", "stream", "--json"])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.get("value"), True)

    def test_history_and_rollback(self) -> None:
        c1, o1 = self._run(["chat", "set", "stream", "on", "--json"])
        self.assertEqual(c1, 0)
        rev = int(o1.get("revision") or 0)
        self.assertGreater(rev, 0)

        c2, _o2 = self._run(["chat", "set", "stream", "off", "--json"])
        self.assertEqual(c2, 0)

        c3, _o3 = self._run(["rollback", str(rev), "--yes", "--json"])
        self.assertEqual(c3, 0)

        c4, o4 = self._run(["chat", "get", "stream", "--json"])
        self.assertEqual(c4, 0)
        self.assertEqual(o4.get("value"), False)

    def test_high_risk_requires_yes(self) -> None:
        code, out = self._run(["im", "set", "telegram_enabled", "on", "--json"])
        self.assertEqual(code, 5)
        self.assertFalse(out.get("ok"))

    def test_coder_set_get_name(self) -> None:
        code1, out1 = self._run(["coder", "set", "name", "Codex Agent", "--json"])
        self.assertEqual(code1, 0)
        self.assertTrue(out1.get("ok"))
        code2, out2 = self._run(["coder", "get", "name", "--json"])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.get("value"), "Codex Agent")

    def test_coder_set_get_command_template(self) -> None:
        code1, out1 = self._run(["coder", "set", "cmd_ask", 'codex exec "{prompt}"', "--json"])
        self.assertEqual(code1, 0)
        self.assertTrue(out1.get("ok"))
        code2, out2 = self._run(["coder", "get", "cmd_ask", "--json"])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.get("value"), 'codex exec "{prompt}"')

    def test_coder_high_risk_command_requires_yes(self) -> None:
        code, out = self._run(["coder", "set", "command", "codex", "--json"])
        self.assertEqual(code, 5)
        self.assertFalse(out.get("ok"))
        code2, out2 = self._run(["coder", "set", "command", "codex", "--yes", "--json"])
        self.assertEqual(code2, 0)
        self.assertTrue(out2.get("ok"))

    def test_status_center_set_get_tray_enabled(self) -> None:
        code1, out1 = self._run(["status_center", "set", "tray_enabled", "on", "--json"])
        self.assertEqual(code1, 0)
        self.assertTrue(out1.get("ok"))
        code2, out2 = self._run(["status_center", "get", "tray_enabled", "--json"])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.get("value"), True)

    def test_status_center_set_get_running_frames(self) -> None:
        value = '["/tmp/frame1.png","/tmp/frame2.png"]'
        code1, out1 = self._run(["status_center", "set", "running_frames", value, "--json"])
        self.assertEqual(code1, 0)
        self.assertTrue(out1.get("ok"))
        code2, out2 = self._run(["status_center", "get", "running_frames", "--json"])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.get("value"), ["/tmp/frame1.png", "/tmp/frame2.png"])


if __name__ == "__main__":
    unittest.main()
