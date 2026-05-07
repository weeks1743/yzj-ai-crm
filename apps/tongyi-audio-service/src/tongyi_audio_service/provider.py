from __future__ import annotations

import json
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

MODEL = "tingwu-meeting"
BASE_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
DONE_STATUSES = {"SUCCEEDED", "FAILED"}
OSS_RESOLVE_HEADERS = {"X-DashScope-OssResourceResolve": "enable"}
REQUIRED_RESULT_FIELDS = (
    "autoChaptersPath",
    "meetingAssistancePath",
    "playbackUrl",
    "pptExtractionPath",
    "summarizationPath",
    "textPolishPath",
    "transcriptionPath",
    "translationsPath",
)


class ProviderError(RuntimeError):
    pass


def run_offline_task(
    *,
    audio_path: Path,
    app_id: str,
    api_key: str,
    output_dir: Path,
    task_dir_name: str | None = None,
    poll_interval_seconds: int,
    timeout_seconds: int,
) -> str:
    dashscope_modules = _load_dashscope()
    oss_url = _upload_audio(dashscope_modules["OssUtils"], audio_path, api_key)
    create_payload = _create_offline_task(
        tingwu=dashscope_modules["TingWu"],
        app_id=app_id,
        file_url=oss_url,
        api_key=api_key,
    )
    data_id = (create_payload.get("output") or {}).get("dataId")
    if not data_id:
        raise ProviderError(f"创建任务失败，未拿到 dataId: {json.dumps(create_payload, ensure_ascii=False)}")

    task_dir = output_dir / (task_dir_name or data_id)
    _write_json(task_dir / "create-task.json", create_payload)
    task_payload = _wait_for_task(
        tingwu=dashscope_modules["TingWu"],
        data_id=data_id,
        api_key=api_key,
        poll_interval_seconds=poll_interval_seconds,
        timeout_seconds=timeout_seconds,
    )
    _write_json(task_dir / "task-result.json", task_payload)
    _download_result_assets(task_dir, task_payload)
    _copy_playback_fallback(audio_path, task_dir)
    (task_dir / "summary.txt").write_text(_build_summary(task_payload, data_id), encoding="utf-8")
    return data_id


def _load_dashscope() -> dict[str, Any]:
    try:
        from dashscope.multimodal.tingwu.tingwu import TingWu
        from dashscope.utils.oss_utils import OssUtils
    except Exception as error:  # pragma: no cover - depends on optional runtime installation
        raise ProviderError(f"缺少 dashscope 依赖，请先安装 requirements.txt（{type(error).__name__}: {error}）") from error
    return {"TingWu": TingWu, "OssUtils": OssUtils}


def _to_plain_dict(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "to_dict"):
        return response.to_dict()
    if hasattr(response, "__dict__"):
        return dict(response.__dict__)
    return {"raw": str(response)}


def _upload_audio(oss_utils: Any, audio_path: Path, api_key: str) -> str:
    oss_url, _ = oss_utils.upload(
        model=MODEL,
        file_path=str(audio_path),
        api_key=api_key,
    )
    return str(oss_url)


def _create_offline_task(*, tingwu: Any, app_id: str, file_url: str, api_key: str) -> dict[str, Any]:
    headers = OSS_RESOLVE_HEADERS if file_url.startswith("oss://") else None
    response = tingwu.call(
        model=MODEL,
        user_defined_input={
            "task": "createTask",
            "type": "offline",
            "appId": app_id,
            "fileUrl": file_url,
        },
        api_key=api_key,
        base_address=BASE_API_URL,
        parameters={},
        headers=headers,
    )
    return _to_plain_dict(response)


def _get_task(*, tingwu: Any, data_id: str, api_key: str) -> dict[str, Any]:
    response = tingwu.call(
        model=MODEL,
        user_defined_input={
            "task": "getTask",
            "dataId": data_id,
        },
        api_key=api_key,
        base_address=BASE_API_URL,
    )
    return _to_plain_dict(response)


def _extract_status(payload: dict[str, Any]) -> str:
    output = payload.get("output") or {}
    for key in ("taskStatus", "status"):
        value = output.get(key)
        if value is not None:
            return str(value)
    return "UNKNOWN"


def _is_task_done(payload: dict[str, Any]) -> bool:
    output = payload.get("output") or {}
    status = output.get("taskStatus")
    if isinstance(status, str) and status.upper() == "FAILED":
        return True
    return not _missing_required_result_fields(payload)


def _missing_required_result_fields(payload: dict[str, Any]) -> list[str]:
    output = payload.get("output") or {}
    if not isinstance(output, dict):
        return list(REQUIRED_RESULT_FIELDS)
    return [field for field in REQUIRED_RESULT_FIELDS if not output.get(field)]


def _wait_for_task(
    *,
    tingwu: Any,
    data_id: str,
    api_key: str,
    poll_interval_seconds: int,
    timeout_seconds: int,
) -> dict[str, Any]:
    started_at = time.time()
    last_payload: dict[str, Any] = {}
    while time.time() - started_at < timeout_seconds:
        payload = _get_task(tingwu=tingwu, data_id=data_id, api_key=api_key)
        last_payload = payload
        if _is_task_done(payload):
            return payload
        time.sleep(poll_interval_seconds)
    missing_fields = ", ".join(_missing_required_result_fields(last_payload))
    suffix = f"，缺少产物: {missing_fields}" if missing_fields else ""
    raise TimeoutError(f"任务在 {timeout_seconds} 秒内未完成，最后状态: {_extract_status(last_payload)}{suffix}")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_summary(payload: dict[str, Any], data_id: str) -> str:
    output = payload.get("output") or {}
    lines = [
        f"dataId: {output.get('dataId') or data_id}",
        f"status: {_extract_status(payload)}",
    ]
    for key in sorted(output.keys()):
        if key.endswith("Path") or key.endswith("Url"):
            lines.append(f"{key}: {output.get(key)}")
    return "\n".join(lines) + "\n"


def _download_if_present(url: str, destination: Path) -> None:
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    destination.write_bytes(response.content)


def _extract_json_title(path: str) -> str:
    if path.endswith("Path"):
        return path[:-4]
    if path.endswith("Url"):
        return path[:-3]
    return path


def _output_file_name(key: str) -> str:
    title = _extract_json_title(key)
    if key == "playbackUrl":
        return "playback.mp3"
    if key.endswith("Path"):
        return f"{title}.json"
    return f"{title}.bin"


def _download_result_assets(task_dir: Path, payload: dict[str, Any]) -> None:
    output = payload.get("output") or {}
    assets_dir = task_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    for key, url in output.items():
        if not isinstance(url, str):
            continue
        if not (key.endswith("Path") or key.endswith("Url")):
            continue
        destination = assets_dir / _output_file_name(key)
        try:
            _download_if_present(url, destination)
        except Exception as exc:
            (assets_dir / f"{_extract_json_title(key)}.error.txt").write_text(str(exc), encoding="utf-8")

    summarization_path = assets_dir / "summarization.json"
    if summarization_path.exists():
        try:
            summarization = json.loads(summarization_path.read_text(encoding="utf-8"))
            mindmap = summarization.get("mindMapSummary")
            if mindmap is not None:
                _write_json(assets_dir / "mindMapSummary.json", {"mindMapSummary": mindmap})
        except Exception as exc:
            (assets_dir / "mindMapSummary.error.txt").write_text(str(exc), encoding="utf-8")

def _copy_playback_fallback(audio_path: Path, task_dir: Path) -> None:
    destination = task_dir / "assets" / "playback.mp3"
    if destination.exists() or not audio_path.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copyfile(audio_path, destination)
    except OSError as exc:
        (destination.parent / "playback.error.txt").write_text(str(exc), encoding="utf-8")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
