import unittest

from anima_backend_shared.providers import get_provider_spec


class ProviderSelectionTests(unittest.TestCase):
    def _provider(self, pid: str, enabled: bool, model: str = "m"):
        return {
            "id": pid,
            "name": pid,
            "type": "openai_compatible",
            "isEnabled": enabled,
            "config": {
                "baseUrl": "https://api.example.com/v1",
                "apiKey": "x",
                "selectedModel": model,
                "models": [model],
            },
        }

    def test_default_provider_id_takes_priority(self) -> None:
        settings_obj = {
            "settings": {"defaultProviderId": "p2"},
            "providers": [
                self._provider("p1", True, "m1"),
                self._provider("p2", True, "m2"),
            ],
        }
        spec = get_provider_spec(settings_obj)
        self.assertIsNotNone(spec)
        self.assertEqual(spec.provider_id, "p2")
        self.assertEqual(spec.model, "m2")

    def test_default_provider_id_disabled_falls_back_to_first_enabled(self) -> None:
        settings_obj = {
            "settings": {"defaultProviderId": "p2"},
            "providers": [
                self._provider("p1", True, "m1"),
                self._provider("p2", False, "m2"),
                self._provider("p3", True, "m3"),
            ],
        }
        spec = get_provider_spec(settings_obj)
        self.assertIsNotNone(spec)
        self.assertEqual(spec.provider_id, "p1")
        self.assertEqual(spec.model, "m1")


if __name__ == "__main__":
    unittest.main()
