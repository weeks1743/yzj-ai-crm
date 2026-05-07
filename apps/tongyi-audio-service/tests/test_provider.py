from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tongyi_audio_service.provider import _is_task_done, _wait_for_task


FULL_OUTPUT = {
    "autoChaptersPath": "https://example.com/autoChapters",
    "meetingAssistancePath": "https://example.com/meetingAssistance",
    "playbackUrl": "https://example.com/playback.mp3",
    "pptExtractionPath": "https://example.com/pptExtraction",
    "summarizationPath": "https://example.com/summarization",
    "textPolishPath": "https://example.com/textPolish",
    "transcriptionPath": "https://example.com/transcription",
    "translationsPath": "https://example.com/translations",
    "status": 0,
}


class ProviderTest(unittest.TestCase):
    def test_status_zero_without_full_assets_is_not_done(self) -> None:
        self.assertFalse(_is_task_done({
            "output": {
                "status": 0,
                "transcriptionPath": "https://example.com/transcription",
                "pptExtractionPath": "https://example.com/pptExtraction",
            }
        }))

    def test_full_tongyi_assets_are_done(self) -> None:
        self.assertTrue(_is_task_done({"output": FULL_OUTPUT}))

    def test_failed_task_status_is_done(self) -> None:
        self.assertTrue(_is_task_done({"output": {"taskStatus": "FAILED"}}))

    def test_wait_for_task_polls_until_full_assets_are_available(self) -> None:
        class FakeTingWu:
            calls = 0

            @classmethod
            def call(cls, **_: object) -> dict[str, object]:
                cls.calls += 1
                if cls.calls == 1:
                    return {
                        "output": {
                            "status": 0,
                            "transcriptionPath": "https://example.com/transcription",
                            "pptExtractionPath": "https://example.com/pptExtraction",
                        }
                    }
                return {"output": FULL_OUTPUT}

        payload = _wait_for_task(
            tingwu=FakeTingWu,
            data_id="DATA-ID",
            api_key="test-key",
            poll_interval_seconds=0,
            timeout_seconds=1,
        )

        self.assertEqual(FakeTingWu.calls, 2)
        self.assertEqual(payload["output"], FULL_OUTPUT)


if __name__ == "__main__":
    unittest.main()
