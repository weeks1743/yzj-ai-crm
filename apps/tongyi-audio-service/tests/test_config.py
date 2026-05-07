from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tongyi_audio_service.config import REPO_ROOT, load_config


class ConfigTest(unittest.TestCase):
    def test_load_config_accepts_original_tongyi_key_names(self) -> None:
        config = load_config({
            "DASHSCOPE_API_KEY": "dashscope-key",
            "TINGWU_APP_ID": "tingwu-app",
        })

        self.assertEqual(config.dashscope_api_key, "dashscope-key")
        self.assertEqual(config.tingwu_app_id, "tingwu-app")
        self.assertTrue(config.provider_configured)

    def test_load_config_resolves_relative_env_paths_from_repo_root(self) -> None:
        config = load_config({
            "TONGYI_AUDIO_OUTPUT_DIR": "tmp/tongyi",
            "TONGYI_AUDIO_FIXTURE_OUTPUT_DIR": "tmp/tongyi",
        })

        self.assertEqual(config.output_dir, (REPO_ROOT / "tmp/tongyi").resolve())
        self.assertEqual(config.fixture_output_dir, (REPO_ROOT / "tmp/tongyi").resolve())

    def test_load_config_defaults_to_tmp_tongyi(self) -> None:
        config = load_config({})

        self.assertEqual(config.output_dir, (REPO_ROOT / "tmp/tongyi").resolve())
        self.assertEqual(config.fixture_output_dir, (REPO_ROOT / "tmp/tongyi").resolve())


if __name__ == "__main__":
    unittest.main()
