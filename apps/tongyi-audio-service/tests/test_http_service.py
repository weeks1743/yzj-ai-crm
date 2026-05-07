from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tongyi_audio_service.config import ServiceConfig
from tongyi_audio_service.provider import ProviderError
from tongyi_audio_service.server import AudioService, create_handler
from tongyi_audio_service.storage import TaskStore


class HttpServiceTest(unittest.TestCase):
    def test_upload_task_reuses_same_md5_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key=None,
                tingwu_app_id=None,
                output_dir=root / "outputs",
                fixture_output_dir=root / "fixtures",
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            store = TaskStore(config)
            first = store.create_upload_task(
                file_name="visit.mp3",
                mime_type="audio/mpeg",
                content=b"same mp3 bytes",
            )
            second = store.create_upload_task(
                file_name="visit-copy.mp3",
                mime_type="audio/mpeg",
                content=b"same mp3 bytes",
            )

            self.assertEqual(first.task_id, second.task_id)
            self.assertEqual(first.file.md5, "1db4760d0720e8749f4199c5c4ceb332")

    def test_upload_task_does_not_map_matching_fixture_playback_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_dir = root / "EV5TddyrE5zM"
            assets_dir = fixture_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "playback.mp3").write_bytes(b"same mp3 bytes")
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key=None,
                tingwu_app_id=None,
                output_dir=root / "outputs",
                fixture_output_dir=fixture_dir,
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            store = TaskStore(config)
            first = store.create_upload_task(
                file_name="贝斯美拜访.mp3",
                mime_type="audio/mpeg",
                content=b"same mp3 bytes",
            )
            second = store.create_upload_task(
                file_name="贝斯美拜访-copy.mp3",
                mime_type="audio/mpeg",
                content=b"same mp3 bytes",
            )

            self.assertEqual(first.task_id, second.task_id)
            self.assertEqual(first.status, "failed")
            self.assertIsNone(first.provider_data_id)
            self.assertIsNone(first.fixture_task_id)
            self.assertIn("缺少 TONGYI_DASHSCOPE_API_KEY", first.error_message or "")

    def test_failed_md5_file_restarts_provider(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key="test-key",
                tingwu_app_id="test-app",
                output_dir=root / "outputs",
                fixture_output_dir=root / "fixtures",
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            store = TaskStore(config)
            with patch(
                "tongyi_audio_service.storage.run_offline_task",
                side_effect=[ProviderError("missing dependency"), "DATA2"],
            ) as provider:
                first = store.create_upload_task(
                    file_name="visit.mp3",
                    mime_type="audio/mpeg",
                    content=b"same mp3 bytes",
                )
                _wait_for_status(store, first.task_id, "failed")
                self.assertEqual(first.error_message, "missing dependency")

                second = store.create_upload_task(
                    file_name="visit-retry.mp3",
                    mime_type="audio/mpeg",
                    content=b"same mp3 bytes",
                )
                self.assertEqual(first.task_id, second.task_id)
                _wait_for_status(store, second.task_id, "succeeded")

                self.assertEqual(provider.call_count, 2)
                self.assertEqual(
                    provider.call_args_list[1].kwargs.get("task_dir_name"),
                    "1db4760d0720e8749f4199c5c4ceb332",
                )
                self.assertEqual(second.provider_data_id, "DATA2")
                self.assertIsNone(second.error_message)

    def test_fixture_task_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_dir = root / "fixtures" / "EV5"
            profile_dir = fixture_dir / "profile-analysis"
            profile_dir.mkdir(parents=True)
            (profile_dir / "crm_visit-20260410-165921.md").write_text(
                "# CRM 客户拜访结构化画像\n\n## 客户侧\n- 核心关注点：预算。",
                encoding="utf-8",
            )
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key=None,
                tingwu_app_id=None,
                output_dir=root / "outputs",
                fixture_output_dir=root / "fixtures",
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            server = ThreadingHTTPServer((config.host, 0), create_handler(AudioService(config)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_port
                status, payload = _request(
                    port,
                    "POST",
                    "/api/audio-tasks",
                    {"fixtureTaskId": "EV5", "anchors": {"customer": "星海精工"}},
                )
                self.assertEqual(status, 201)
                self.assertEqual(payload["status"], "succeeded")
                task_id = payload["taskId"]

                status, payload = _request(port, "GET", f"/api/audio-tasks/{task_id}")
                self.assertEqual(status, 200)
                self.assertEqual(payload["fixtureTaskId"], "EV5")

                status, payload = _request(port, "POST", f"/api/audio-tasks/{task_id}/materialize", {})
                self.assertEqual(status, 200)
                self.assertTrue(payload["material"]["available"])
                self.assertIn("预算", payload["material"]["markdown"])
                self.assertNotIn("transcription.json", payload["material"]["markdown"])
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()

    def test_fixture_output_dir_can_point_to_task_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_dir = root / "EV5TddyrE5zM"
            assets_dir = fixture_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "summarization.json").write_text(
                json.dumps({"paragraphSummary": "真实客户拜访讨论预算和试点。"}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "mindMapSummary.json").write_text(
                json.dumps({"mindMapSummary": [{"title": "真实拜访议题"}]}, ensure_ascii=False),
                encoding="utf-8",
            )
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key=None,
                tingwu_app_id=None,
                output_dir=root / "outputs",
                fixture_output_dir=fixture_dir,
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            server = ThreadingHTTPServer((config.host, 0), create_handler(AudioService(config)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_port
                status, payload = _request(
                    port,
                    "POST",
                    "/api/audio-tasks",
                    {"fixtureTaskId": "EV5TddyrE5zM", "fileName": "贝斯美拜访.mp3"},
                )
                self.assertEqual(status, 201)
                self.assertEqual(payload["status"], "succeeded")
                self.assertEqual(payload["fixtureTaskId"], "EV5TddyrE5zM")

                status, payload = _request(port, "GET", "/api/tasks")
                self.assertEqual(status, 200)
                self.assertEqual(payload["tasks"][0]["id"], "EV5TddyrE5zM")

                status, payload = _request(port, "GET", "/api/task/EV5TddyrE5zM")
                self.assertEqual(status, 200)
                self.assertEqual(payload["assets"]["summarization"]["paragraphSummary"], "真实客户拜访讨论预算和试点。")
                self.assertEqual(payload["assets"]["summarization"]["mindMapSummary"][0]["title"], "真实拜访议题")
                self.assertEqual(payload["assets"]["mindMapSummary"]["mindMapSummary"][0]["title"], "真实拜访议题")
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()

    def test_meeting_viewer_serves_fixture_bundle_and_audio_range(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_dir = root / "fixtures" / "EV5"
            assets_dir = fixture_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "playback.mp3").write_bytes(b"fake-audio-bytes")
            (assets_dir / "transcription.json").write_text(
                json.dumps({"paragraphs": [{"text": "客户关注预算和推进节奏。"}]}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "summarization.json").write_text(
                json.dumps({"paragraphSummary": "本次拜访讨论预算、审批和试点推进。"}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "mindMapSummary.json").write_text(
                json.dumps({"mindMapSummary": [{"title": "会议讨论概览", "topic": [{"title": "试点推进"}]}]}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "meetingAssistance.json").write_text(
                json.dumps({"keywords": ["预算", "审批", "试点"]}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "autoChapters.json").write_text("[]", encoding="utf-8")
            config = ServiceConfig(
                host="127.0.0.1",
                port=0,
                dashscope_api_key=None,
                tingwu_app_id=None,
                output_dir=root / "outputs",
                fixture_output_dir=root / "fixtures",
                poll_interval_seconds=1,
                task_timeout_seconds=1,
            )
            server = ThreadingHTTPServer((config.host, 0), create_handler(AudioService(config)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_port

                status, headers, body = _raw_request(port, "GET", "/meeting-viewer/")
                self.assertEqual(status, 200)
                self.assertIn("text/html", headers["content-type"])
                self.assertIn("智能纪要查看器", body.decode("utf-8"))

                status, payload = _request(port, "GET", "/api/tasks")
                self.assertEqual(status, 200)
                self.assertEqual(payload["tasks"][0]["id"], "EV5")

                status, payload = _request(port, "GET", "/api/task/EV5")
                self.assertEqual(status, 200)
                self.assertEqual(payload["assets"]["meetingAssistance"]["keywords"], ["预算", "审批", "试点"])
                self.assertEqual(payload["assets"]["summarization"]["mindMapSummary"][0]["title"], "会议讨论概览")
                self.assertEqual(payload["assets"]["mindMapSummary"]["mindMapSummary"][0]["topic"][0]["title"], "试点推进")
                self.assertEqual(payload["media"]["playbackUrl"], "/outputs/EV5/assets/playback.mp3")

                status, headers, body = _raw_request(
                    port,
                    "GET",
                    "/outputs/EV5/assets/playback.mp3",
                    {"Range": "bytes=0-3"},
                )
                self.assertEqual(status, 206)
                self.assertEqual(headers["content-range"], "bytes 0-3/16")
                self.assertEqual(body, b"fake")

                status, payload = _request(
                    port,
                    "POST",
                    "/api/task/EV5/profile-analysis",
                    {"scenario": "crm_visit"},
                )
                self.assertEqual(status, 200)
                self.assertIn("CRM 客户拜访结构化画像", payload["markdown"])
                self.assertTrue((fixture_dir / "profile-analysis").exists())

                status, payload = _request(port, "GET", "/api/task/missing")
                self.assertEqual(status, 404)
                self.assertEqual(payload["code"], "TASK_NOT_FOUND")
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()


def _request(port: int, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if method != "GET" else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    data = response.read()
    connection.close()
    return response.status, json.loads(data.decode("utf-8") or "{}")


def _raw_request(
    port: int,
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request(method, path, headers=headers or {})
    response = connection.getresponse()
    data = response.read()
    response_headers = {key.lower(): value for key, value in response.getheaders()}
    connection.close()
    return response.status, response_headers, data


def _wait_for_status(store: TaskStore, task_id: str, status: str, timeout_seconds: float = 2) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if store.get_task(task_id).status == status:
            return
        time.sleep(0.02)
    raise AssertionError(f"Task {task_id} did not reach {status}")


if __name__ == "__main__":
    unittest.main()
