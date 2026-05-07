import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

import requests
from dashscope.multimodal.tingwu.tingwu import TingWu
from dashscope.utils.oss_utils import OssUtils


MODEL = "tingwu-meeting"
BASE_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
DONE_STATUSES = {"SUCCEEDED", "FAILED"}
OSS_RESOLVE_HEADERS = {"X-DashScope-OssResourceResolve": "enable"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通义听悟离线录音验证脚本")
    parser.add_argument("--app-id", help="通义听悟应用 ID")
    parser.add_argument("--audio", help="本地音频文件路径")
    parser.add_argument("--data-id", help="已有任务 ID，传入后跳过上传和建任务")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("DASHSCOPE_API_KEY"),
        help="DashScope API Key，默认读取 DASHSCOPE_API_KEY",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=10,
        help="轮询间隔秒数，默认 10 秒",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=1800,
        help="最大等待时间，单位秒，默认 1800 秒",
    )
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[1] / "outputs"),
        help="结果输出目录",
    )
    return parser.parse_args()


def require_api_key(api_key: str) -> str:
    if api_key:
        return api_key
    raise SystemExit("缺少 API Key，请设置 DASHSCOPE_API_KEY 或通过 --api-key 传入。")


def ensure_file(path_str: str) -> Path:
    path = Path(path_str).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise SystemExit(f"音频文件不存在: {path}")
    return path


def to_plain_dict(response: Any) -> Dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "to_dict"):
        return response.to_dict()
    if hasattr(response, "__dict__"):
        return dict(response.__dict__)
    return {"raw": str(response)}


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def upload_audio(model: str, audio_path: Path, api_key: str) -> str:
    print(f"[1/4] 上传音频到 DashScope OSS: {audio_path}")
    oss_url, _ = OssUtils.upload(
        model=model,
        file_path=str(audio_path),
        api_key=api_key,
    )
    print(f"上传完成，OSS 地址: {oss_url}")
    return oss_url


def create_offline_task(model: str, app_id: str, file_url: str, api_key: str) -> Dict[str, Any]:
    print("[2/4] 创建离线分析任务")
    headers = OSS_RESOLVE_HEADERS if file_url.startswith("oss://") else None
    response = TingWu.call(
        model=model,
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
    payload = to_plain_dict(response)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return payload


def get_task(model: str, data_id: str, api_key: str) -> Dict[str, Any]:
    response = TingWu.call(
        model=model,
        user_defined_input={
            "task": "getTask",
            "dataId": data_id,
        },
        api_key=api_key,
        base_address=BASE_API_URL,
    )
    return to_plain_dict(response)


def extract_status(payload: Dict[str, Any]) -> str:
    output = payload.get("output", {})
    for key in ("taskStatus", "status"):
        value = output.get(key)
        if value is not None:
            return str(value)
    return "UNKNOWN"


def is_task_done(payload: Dict[str, Any]) -> bool:
    output = payload.get("output") or {}
    status = output.get("taskStatus")
    if isinstance(status, str) and status.upper() in DONE_STATUSES:
        return True
    if output.get("status") in (0, "0"):
        return True
    ready_fields = [
        "transcriptionPath",
        "summarizationPath",
        "meetingAssistancePath",
        "autoChaptersPath",
    ]
    return any(output.get(field) for field in ready_fields)


def wait_for_task(model: str, data_id: str, api_key: str, poll_interval: int, timeout: int) -> Dict[str, Any]:
    print("[3/4] 轮询任务结果")
    start = time.time()
    last_payload: Dict[str, Any] = {}
    while time.time() - start < timeout:
        payload = get_task(model=model, data_id=data_id, api_key=api_key)
        last_payload = payload
        status = extract_status(payload)
        print(f"{datetime.now().strftime('%H:%M:%S')} 任务状态: {status}")
        if is_task_done(payload):
            return payload
        time.sleep(poll_interval)
    raise TimeoutError(f"任务在 {timeout} 秒内未完成，最后状态: {extract_status(last_payload)}")


def build_summary(payload: Dict[str, Any], data_id: str) -> str:
    output = payload.get("output") or {}
    lines = []
    lines.append(f"dataId: {output.get('dataId') or data_id}")
    lines.append(f"status: {extract_status(payload)}")
    for key in sorted(output.keys()):
        if key.endswith("Path") or key.endswith("Url"):
            lines.append(f"{key}: {output.get(key)}")

    return "\n".join(lines) + "\n"


def download_if_present(url: str, destination: Path) -> None:
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    destination.write_bytes(response.content)


def extract_json_title(path: str) -> str:
    if path.endswith("Path"):
        return path[:-4]
    if path.endswith("Url"):
        return path[:-3]
    return path


def output_file_name(key: str) -> str:
    title = extract_json_title(key)
    if key == "playbackUrl":
        return "playback.mp3"
    if key.endswith("Path"):
        return f"{title}.json"
    return f"{title}.bin"


def download_result_assets(task_dir: Path, payload: Dict[str, Any]) -> None:
    output = payload.get("output") or {}
    assets_dir = task_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    for key, url in output.items():
        if not isinstance(url, str):
            continue
        if not (key.endswith("Path") or key.endswith("Url")):
            continue
        destination = assets_dir / output_file_name(key)
        try:
            download_if_present(url, destination)
        except Exception as exc:
            (assets_dir / f"{extract_json_title(key)}.error.txt").write_text(
                str(exc),
                encoding="utf-8",
            )

    summarization_path = assets_dir / "summarization.json"
    if summarization_path.exists():
        try:
            summarization = json.loads(summarization_path.read_text(encoding="utf-8"))
            mindmap = summarization.get("mindMapSummary")
            if mindmap is not None:
                write_json(assets_dir / "mindMapSummary.json", {"mindMapSummary": mindmap})
        except Exception as exc:
            (assets_dir / "mindMapSummary.error.txt").write_text(str(exc), encoding="utf-8")


def main() -> int:
    args = parse_args()
    api_key = require_api_key(args.api_key)
    create_payload = None

    if args.data_id:
        data_id = args.data_id
    else:
        if not args.app_id:
            raise SystemExit("未传入 --data-id 时，必须提供 --app-id。")
        if not args.audio:
            raise SystemExit("未传入 --data-id 时，必须提供 --audio。")
        audio_path = ensure_file(args.audio)
        file_url = upload_audio(model=MODEL, audio_path=audio_path, api_key=api_key)
        create_payload = create_offline_task(
            model=MODEL,
            app_id=args.app_id,
            file_url=file_url,
            api_key=api_key,
        )
        data_id = (create_payload.get("output") or {}).get("dataId")
        if not data_id:
            raise RuntimeError(f"创建任务失败，未拿到 dataId: {json.dumps(create_payload, ensure_ascii=False)}")

    task_dir = Path(args.output_dir).expanduser().resolve() / data_id
    if create_payload is not None:
        write_json(task_dir / "create-task.json", create_payload)

    task_payload = wait_for_task(
        model=MODEL,
        data_id=data_id,
        api_key=api_key,
        poll_interval=args.poll_interval,
        timeout=args.timeout,
    )
    write_json(task_dir / "task-result.json", task_payload)
    download_result_assets(task_dir, task_payload)
    (task_dir / "summary.txt").write_text(build_summary(task_payload, data_id), encoding="utf-8")

    print(f"[4/4] 结果已保存到: {task_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("用户中断执行。", file=sys.stderr)
        raise SystemExit(130)
