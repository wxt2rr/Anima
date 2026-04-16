from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


class KnowledgeBaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config_td = tempfile.TemporaryDirectory()
        self.workspace_td = tempfile.TemporaryDirectory()
        os.environ["ANIMA_CONFIG_ROOT"] = self.config_td.name

    def tearDown(self) -> None:
        if "ANIMA_CONFIG_ROOT" in os.environ:
            del os.environ["ANIMA_CONFIG_ROOT"]
        self.workspace_td.cleanup()
        self.config_td.cleanup()

    @staticmethod
    def _mock_embed(text: str, _settings_obj: dict) -> list[float]:
        s = str(text or "")
        base = float(sum(ord(ch) for ch in s) % 97)
        return [base / 100.0, float(len(s) % 89) / 100.0, 0.5]

    def test_import_list_query_delete(self) -> None:
        from anima_backend_shared.knowledge_base import (
            delete_kb_documents,
            import_markdown_files,
            list_kb_documents,
            query_kb_chunks,
        )

        md_path = Path(self.workspace_td.name) / "guide.md"
        md_path.write_text("# Intro\nAnima supports markdown knowledge base.\n\n## Usage\nUse RAG retrieval for answers.", encoding="utf-8")

        with patch("anima_backend_shared.knowledge_base.embed_text", side_effect=self._mock_embed):
            res = import_markdown_files(workspace_dir=self.workspace_td.name, paths=[str(md_path)])
            self.assertEqual(int(res.get("imported") or 0), 1)

            docs = list_kb_documents(workspace_dir=self.workspace_td.name)
            self.assertEqual(len(docs), 1)
            self.assertGreaterEqual(int(docs[0].get("chunkCount") or 0), 1)

            rows = query_kb_chunks(
                workspace_dir=self.workspace_td.name,
                query="markdown retrieval",
                top_k=3,
                similarity_threshold=0.0,
            )
            self.assertGreaterEqual(len(rows), 1)
            self.assertEqual(str(rows[0].get("fileName") or ""), "guide.md")

            deleted = delete_kb_documents(workspace_dir=self.workspace_td.name, ids=[str(docs[0].get("id") or "")])
            self.assertEqual(int(deleted.get("deleted") or 0), 1)
            docs_after = list_kb_documents(workspace_dir=self.workspace_td.name)
            self.assertEqual(len(docs_after), 0)

    def test_import_unchanged_is_skipped(self) -> None:
        from anima_backend_shared.knowledge_base import import_markdown_files

        md_path = Path(self.workspace_td.name) / "notes.md"
        md_path.write_text("hello\n\nworld", encoding="utf-8")

        with patch("anima_backend_shared.knowledge_base.embed_text", side_effect=self._mock_embed):
            first = import_markdown_files(workspace_dir=self.workspace_td.name, paths=[str(md_path)])
            second = import_markdown_files(workspace_dir=self.workspace_td.name, paths=[str(md_path)])

        self.assertEqual(int(first.get("imported") or 0), 1)
        self.assertEqual(int(second.get("skipped") or 0), 1)


if __name__ == "__main__":
    unittest.main()
