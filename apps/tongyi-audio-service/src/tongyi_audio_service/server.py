from __future__ import annotations

import errno
import json
import mimetypes
import re
import sys
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .config import ServiceConfig, load_config
from .storage import TaskStore, resolve_fixture_task_dir

VIEWER_STATIC_DIR = Path(__file__).resolve().parents[2] / "legacy-tongyi-agent" / "meeting-viewer"
PROFILE_DIR_NAME = "profile-analysis"
RANGE_CHUNK_SIZE = 64 * 1024
AUDIO_VIEWER_PREFIX = "/audio-viewer"


class AudioService:
    def __init__(self, config: ServiceConfig):
        self.config = config
        self.store = TaskStore(config)


def create_handler(service: AudioService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "TongyiAudioService/0.9.0"

        def do_OPTIONS(self) -> None:
            self._json({}, HTTPStatus.NO_CONTENT)

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            route_path = _strip_audio_viewer_prefix(parsed.path)
            if route_path == "/" and _has_audio_viewer_prefix(parsed.path):
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", f"{AUDIO_VIEWER_PREFIX}/meeting-viewer/")
                self.end_headers()
                return None

            if route_path == "/health":
                return self._json({
                    "status": "ok",
                    "provider": "tongyi-tingwu",
                    "providerConfigured": service.config.provider_configured,
                    "outputDir": str(service.config.output_dir),
                    "fixtureOutputDir": str(service.config.fixture_output_dir),
                    "capabilities": [
                        "audio_upload",
                        "fixture_task",
                        "transcription",
                        "summary",
                        "chapters",
                        "keywords",
                        "speakers",
                        "playback",
                        "recording_material",
                    ],
                })

            if route_path == "/meeting-viewer":
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", _with_audio_viewer_prefix(parsed.path, "/meeting-viewer/"))
                self.end_headers()
                return None

            if route_path == "/meeting-viewer/":
                return self._serve_viewer_static("index.html")

            if route_path.startswith("/meeting-viewer/"):
                return self._serve_viewer_static(route_path.removeprefix("/meeting-viewer/"))

            if route_path == "/api/tasks":
                return self._json({"tasks": _list_viewer_tasks(service.config)})

            viewer_task_id = _match_viewer_task_path(route_path)
            if viewer_task_id:
                bundle = _load_viewer_task_bundle(service.config, viewer_task_id)
                if bundle is None:
                    return self._json_error("TASK_NOT_FOUND", "Task not found", HTTPStatus.NOT_FOUND)
                return self._json(bundle)

            if route_path.startswith("/outputs/"):
                return self._serve_output_file(route_path)

            task_id = _match_task_path(route_path)
            if task_id:
                try:
                    task = service.store.get_task(task_id)
                except KeyError:
                    return self._json_error("TASK_NOT_FOUND", "录音任务不存在", HTTPStatus.NOT_FOUND)
                return self._json(task.to_json(service.config))

            return self._json_error("NOT_FOUND", "Not found", HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            route_path = _strip_audio_viewer_prefix(parsed.path)
            if route_path == "/api/audio-tasks":
                return self._create_task()

            viewer_profile_task_id = _match_viewer_profile_path(route_path)
            if viewer_profile_task_id:
                return self._create_viewer_profile_analysis(viewer_profile_task_id)

            materialize_task_id = _match_materialize_path(route_path)
            if materialize_task_id:
                return self._materialize_task(materialize_task_id)

            return self._json_error("NOT_FOUND", "Not found", HTTPStatus.NOT_FOUND)

        def _create_task(self) -> None:
            try:
                content_type = self.headers.get("Content-Type") or ""
                if content_type.startswith("multipart/form-data"):
                    fields, files = _read_multipart(self)
                    file_item = files.get("file") or files.get("audio") or next(iter(files.values()), None)
                    if not file_item:
                        return self._json_error("BAD_REQUEST", "请上传音频文件", HTTPStatus.BAD_REQUEST)
                    anchors = _parse_anchors(fields.get("anchors") or fields.get("anchorsJson"))
                    task = service.store.create_upload_task(
                        file_name=file_item["fileName"],
                        mime_type=file_item["mimeType"],
                        content=file_item["content"],
                        anchors=anchors,
                    )
                    return self._json(task.to_json(service.config), HTTPStatus.CREATED)

                payload = _read_json(self)
                fixture_task_id = str(payload.get("fixtureTaskId") or payload.get("taskId") or "").strip()
                if not fixture_task_id:
                    return self._json_error("BAD_REQUEST", "fixtureTaskId 不能为空", HTTPStatus.BAD_REQUEST)
                task = service.store.create_fixture_task(
                    fixture_task_id,
                    anchors=_parse_anchors(payload.get("anchors")),
                    source_file_name=payload.get("fileName"),
                )
                return self._json(task.to_json(service.config), HTTPStatus.CREATED)
            except FileNotFoundError as error:
                return self._json_error("FIXTURE_NOT_FOUND", str(error), HTTPStatus.NOT_FOUND)
            except ValueError as error:
                return self._json_error("BAD_REQUEST", str(error), HTTPStatus.BAD_REQUEST)

        def _create_viewer_profile_analysis(self, task_id: str) -> None:
            bundle = _load_viewer_task_bundle(service.config, task_id)
            if bundle is None:
                return self._json_error("TASK_NOT_FOUND", "Task not found", HTTPStatus.NOT_FOUND)

            try:
                payload = _read_json(self)
            except ValueError as error:
                return self._json_error("BAD_REQUEST", str(error), HTTPStatus.BAD_REQUEST)

            scenario = str(payload.get("scenario") or "crm_visit").strip() or "crm_visit"
            if scenario not in {"interview", "crm_visit"}:
                return self._json_error("BAD_REQUEST", "Invalid scenario", HTTPStatus.BAD_REQUEST)

            markdown = _build_viewer_profile_markdown(task_id, scenario, bundle)
            task_dir = _find_viewer_task_dir(service.config, task_id)
            if task_dir is None:
                return self._json_error("TASK_NOT_FOUND", "Task not found", HTTPStatus.NOT_FOUND)

            profile_dir = task_dir / PROFILE_DIR_NAME
            profile_dir.mkdir(parents=True, exist_ok=True)
            file_name = f"{scenario}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
            profile_path = profile_dir / file_name
            profile_path.write_text(markdown, encoding="utf-8")

            return self._json({
                "taskId": task_id,
                "scenario": scenario,
                "prompt": "基于 viewer 可见过程资料生成本地结构化画像。",
                "markdown": markdown,
                "markdownUrl": f"/outputs/{task_id}/{PROFILE_DIR_NAME}/{file_name}",
                "detectedSpeakers": [],
                "appliedAliases": payload.get("speaker_aliases") or {},
            })

        def _materialize_task(self, task_id: str) -> None:
            try:
                payload = _read_json(self)
                task, material = service.store.materialize(
                    task_id,
                    preferred_source=str(payload.get("preferredSource") or "auto"),
                    anchors=_parse_anchors(payload.get("anchors")),
                )
                return self._json({
                    **task.to_json(service.config),
                    "material": {
                        "available": True,
                        "path": task.material_path,
                        "source": material.source,
                        "fileName": material.file_name,
                        "markdown": material.markdown,
                        "excludedProcessFiles": list(material.excluded_process_files),
                    },
                })
            except KeyError:
                return self._json_error("TASK_NOT_FOUND", "录音任务不存在", HTTPStatus.NOT_FOUND)
            except FileNotFoundError as error:
                return self._json_error("OUTPUT_NOT_FOUND", str(error), HTTPStatus.NOT_FOUND)
            except RuntimeError as error:
                return self._json_error("TASK_NOT_READY", str(error), HTTPStatus.CONFLICT)
            except ValueError as error:
                return self._json_error("BAD_REQUEST", str(error), HTTPStatus.BAD_REQUEST)

        def _json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            if status != HTTPStatus.NO_CONTENT:
                self.wfile.write(body)

        def _json_error(self, code: str, message: str, status: HTTPStatus) -> None:
            self._json({"code": code, "message": message}, status)

        def _serve_viewer_static(self, relative_path: str) -> None:
            if not VIEWER_STATIC_DIR.exists():
                return self._json_error("VIEWER_NOT_FOUND", "meeting-viewer 静态资源不存在", HTTPStatus.NOT_FOUND)
            normalized = unquote(relative_path or "index.html").lstrip("/")
            if normalized in {"", "."}:
                normalized = "index.html"
            path = (VIEWER_STATIC_DIR / normalized).resolve()
            if not _is_path_within(VIEWER_STATIC_DIR.resolve(), path) or not path.is_file():
                return self._json_error("NOT_FOUND", "Not found", HTTPStatus.NOT_FOUND)
            self._serve_file(path)

        def _serve_output_file(self, request_path: str) -> None:
            path_parts = [unquote(item) for item in request_path.split("/") if item]
            if len(path_parts) < 3 or path_parts[0] != "outputs":
                return self._json_error("NOT_FOUND", "Not found", HTTPStatus.NOT_FOUND)
            task_id = path_parts[1]
            task_dir = _find_viewer_task_dir(service.config, task_id)
            if task_dir is None:
                return self._json_error("TASK_NOT_FOUND", "Task not found", HTTPStatus.NOT_FOUND)
            file_path = task_dir.joinpath(*path_parts[2:]).resolve()
            if not _is_path_within(task_dir.resolve(), file_path) or not file_path.is_file():
                return self._json_error("NOT_FOUND", "Not found", HTTPStatus.NOT_FOUND)
            if file_path.name == "playback.mp3":
                return self._serve_file_with_range(file_path)
            return self._serve_file(file_path)

        def _serve_file(self, path: Path) -> None:
            content = path.read_bytes()
            content_type = _guess_content_type(path)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def _serve_file_with_range(self, path: Path) -> None:
            file_size = path.stat().st_size
            range_header = self.headers.get("Range")
            try:
                start, end = _parse_range_header(range_header, file_size)
            except ValueError:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", "0")
                self.send_header("Content-Type", _guess_content_type(path))
                self.end_headers()
                return None

            status = HTTPStatus.PARTIAL_CONTENT if range_header else HTTPStatus.OK
            content_length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", _guess_content_type(path))
            self.send_header("Content-Length", str(content_length))
            self.send_header("Accept-Ranges", "bytes")
            if status == HTTPStatus.PARTIAL_CONTENT:
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            with path.open("rb") as file:
                file.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = file.read(min(RANGE_CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Handler


def _match_task_path(path: str) -> str | None:
    match = re.fullmatch(r"/api/audio-tasks/([^/]+)", path)
    return unquote(match.group(1)) if match else None


def _match_materialize_path(path: str) -> str | None:
    match = re.fullmatch(r"/api/audio-tasks/([^/]+)/materialize", path)
    return unquote(match.group(1)) if match else None


def _match_viewer_task_path(path: str) -> str | None:
    match = re.fullmatch(r"/api/task/([^/]+)", path)
    return unquote(match.group(1)) if match else None


def _match_viewer_profile_path(path: str) -> str | None:
    match = re.fullmatch(r"/api/task/([^/]+)/profile-analysis", path)
    return unquote(match.group(1)) if match else None


def _strip_audio_viewer_prefix(path: str) -> str:
    if path == AUDIO_VIEWER_PREFIX:
        return "/"
    if path.startswith(f"{AUDIO_VIEWER_PREFIX}/"):
        return path.removeprefix(AUDIO_VIEWER_PREFIX)
    return path


def _has_audio_viewer_prefix(path: str) -> bool:
    return path == AUDIO_VIEWER_PREFIX or path.startswith(f"{AUDIO_VIEWER_PREFIX}/")


def _with_audio_viewer_prefix(original_path: str, target_path: str) -> str:
    if _has_audio_viewer_prefix(original_path):
        return f"{AUDIO_VIEWER_PREFIX}{target_path}"
    return target_path


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("请求体必须是合法 JSON") from error
    if not isinstance(payload, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return payload


def _read_multipart(handler: BaseHTTPRequestHandler) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    content_type = handler.headers.get("Content-Type") or ""
    boundary_match = re.search(r"boundary=(?P<boundary>[^;]+)", content_type)
    if not boundary_match:
        raise ValueError("multipart 请求缺少 boundary")
    boundary = boundary_match.group("boundary").strip('"')
    length = int(handler.headers.get("Content-Length") or "0")
    body = handler.rfile.read(length)
    delimiter = b"--" + boundary.encode("utf-8")
    fields: dict[str, str] = {}
    files: dict[str, dict[str, Any]] = {}

    for part in body.split(delimiter):
        part = part.strip()
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].strip()
        header_blob, separator, content = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        content = content.rstrip(b"\r\n")
        headers = _parse_part_headers(header_blob)
        disposition = headers.get("content-disposition", "")
        name = _parse_header_param(disposition, "name")
        if not name:
            continue
        file_name = _parse_header_param(disposition, "filename")
        if file_name is not None:
            files[name] = {
                "fileName": file_name,
                "mimeType": headers.get("content-type", "application/octet-stream"),
                "content": content,
            }
        else:
            fields[name] = content.decode("utf-8")
    return fields, files


def _parse_part_headers(header_blob: bytes) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in header_blob.decode("utf-8", errors="replace").split("\r\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def _parse_header_param(header: str, name: str) -> str | None:
    match = re.search(rf'{re.escape(name)}="([^"]*)"', header)
    if match:
        return match.group(1)
    match = re.search(rf"{re.escape(name)}=([^;]+)", header)
    return match.group(1).strip() if match else None


def _parse_anchors(value: Any) -> dict[str, str]:
    if value is None or value == "":
        return {}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError("anchors 必须是 JSON 对象") from error
        value = parsed
    if not isinstance(value, dict):
        raise ValueError("anchors 必须是 JSON 对象")
    return {str(key): str(item) for key, item in value.items() if item is not None}


def _list_viewer_tasks(config: ServiceConfig) -> list[dict[str, Any]]:
    seen: set[str] = set()
    tasks: list[dict[str, Any]] = []
    for root in (config.output_dir, config.fixture_output_dir):
        if not root.exists():
            continue
        if _is_viewer_task_dir(root):
            seen.add(root.name)
            tasks.append(_viewer_task_meta(root))
            continue
        for task_dir in root.iterdir():
            if not _is_viewer_task_dir(task_dir) or task_dir.name.startswith("_") or task_dir.name in seen:
                continue
            seen.add(task_dir.name)
            tasks.append(_viewer_task_meta(task_dir))
    tasks.sort(key=lambda item: str(item["updatedAt"]), reverse=True)
    return tasks


def _find_viewer_task_dir(config: ServiceConfig, task_id: str) -> Path | None:
    safe_task_id = task_id.strip()
    if not safe_task_id or "/" in safe_task_id or "\\" in safe_task_id:
        return None
    for root in (config.output_dir, config.fixture_output_dir):
        if root.name == safe_task_id and _is_viewer_task_dir(root):
            return root
        candidate = root / safe_task_id
        if candidate.exists() and candidate.is_dir():
            return candidate
    indexed_task_dir = _find_viewer_task_dir_from_task_index(config, safe_task_id)
    if indexed_task_dir is not None:
        return indexed_task_dir
    return None


def _find_viewer_task_dir_from_task_index(config: ServiceConfig, task_id: str) -> Path | None:
    task_store_dir = config.output_dir / "_tasks"
    if not task_store_dir.exists():
        return None

    for path in task_store_dir.glob("*.json"):
        payload = _read_json_file(path)
        if not isinstance(payload, dict):
            continue
        file_payload = payload.get("file")
        file_md5 = file_payload.get("md5") if isinstance(file_payload, dict) else None
        aliases = {
            payload.get("taskId"),
            payload.get("providerDataId"),
            payload.get("fixtureTaskId"),
            file_md5,
        }
        if task_id not in {str(item) for item in aliases if item}:
            continue
        for candidate in _viewer_task_dir_candidates(config, payload, file_md5):
            if _is_viewer_task_dir(candidate):
                return candidate
    return None


def _viewer_task_dir_candidates(config: ServiceConfig, payload: dict[str, Any], file_md5: Any) -> list[Path]:
    candidates: list[Path] = []
    fixture_task_id = payload.get("fixtureTaskId")
    if isinstance(fixture_task_id, str) and fixture_task_id.strip():
        candidates.append(resolve_fixture_task_dir(config, fixture_task_id.strip()))
    for value in (file_md5, payload.get("providerDataId"), payload.get("taskId")):
        if isinstance(value, str) and value.strip():
            candidates.append(config.output_dir / value.strip())
    return candidates


def _is_viewer_task_dir(path: Path) -> bool:
    return path.is_dir() and (
        (path / "assets").is_dir()
        or (path / "task-result.json").is_file()
        or (path / "create-task.json").is_file()
    )


def _load_viewer_task_bundle(config: ServiceConfig, task_id: str) -> dict[str, Any] | None:
    task_dir = _find_viewer_task_dir(config, task_id)
    if task_dir is None:
        return None

    assets_dir = task_dir / "assets"
    _ensure_viewer_playback_fallback(config, task_dir)
    playback_path = assets_dir / "playback.mp3"
    transcription = _read_json_file(assets_dir / "transcription.json")
    mindmap = _read_json_file(assets_dir / "mindMapSummary.json")
    summarization = _merge_viewer_summarization_mindmap(
        _read_json_file(assets_dir / "summarization.json"),
        mindmap,
    )
    return {
        "id": task_id,
        "meta": _viewer_task_meta(task_dir),
        "createTask": _read_json_file(task_dir / "create-task.json"),
        "taskResult": _read_json_file(task_dir / "task-result.json"),
        "summaryText": _read_text_file(task_dir / "summary.txt"),
        "assets": {
            "transcription": transcription,
            "translations": _read_json_file(assets_dir / "translations.json"),
            "textPolish": _read_json_file(assets_dir / "textPolish.json"),
            "summarization": summarization,
            "mindMapSummary": mindmap,
            "meetingAssistance": _read_json_file(assets_dir / "meetingAssistance.json"),
            "autoChapters": _read_json_file(assets_dir / "autoChapters.json"),
            "pptExtraction": _read_json_file(assets_dir / "pptExtraction.json"),
        },
        "media": {
            "playbackUrl": f"/outputs/{task_id}/assets/playback.mp3" if playback_path.exists() else None,
        },
    }


def _merge_viewer_summarization_mindmap(summarization: Any, mindmap: Any) -> Any | None:
    if summarization is None and mindmap is None:
        return None
    if not isinstance(summarization, dict):
        summarization = {}
    if summarization.get("mindMapSummary"):
        return summarization
    if isinstance(mindmap, dict) and mindmap.get("mindMapSummary"):
        return {**summarization, "mindMapSummary": mindmap.get("mindMapSummary")}
    if isinstance(mindmap, list) and mindmap:
        return {**summarization, "mindMapSummary": mindmap}
    return summarization


def _ensure_viewer_playback_fallback(config: ServiceConfig, task_dir: Path) -> None:
    assets_dir = task_dir / "assets"
    if not assets_dir.exists():
        return
    playback_path = assets_dir / "playback.mp3"
    if playback_path.exists():
        return
    upload_path = _find_uploaded_audio_for_task(config, task_dir.name)
    if not upload_path:
        return
    try:
        playback_path.write_bytes(upload_path.read_bytes())
    except OSError:
        return


def _find_uploaded_audio_for_task(config: ServiceConfig, task_id: str) -> Path | None:
    task_store_dir = config.output_dir / "_tasks"
    if not task_store_dir.exists():
        return None
    for path in task_store_dir.glob("*.json"):
        payload = _read_json_file(path)
        if not isinstance(payload, dict):
            continue
        if task_id not in {payload.get("providerDataId"), payload.get("fixtureTaskId"), payload.get("taskId")}:
            continue
        file_payload = payload.get("file")
        local_path = file_payload.get("localPath") if isinstance(file_payload, dict) else None
        if not local_path:
            continue
        candidate = Path(str(local_path)).expanduser()
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _viewer_task_meta(task_dir: Path) -> dict[str, Any]:
    assets_dir = task_dir / "assets"
    create_task = _read_json_file(task_dir / "create-task.json") or {}
    task_result = _read_json_file(task_dir / "task-result.json") or {}
    output = task_result.get("output") if isinstance(task_result, dict) else {}
    create_output = create_task.get("output") if isinstance(create_task, dict) else {}
    asset_names = sorted(path.name for path in assets_dir.iterdir() if path.is_file()) if assets_dir.exists() else []
    return {
        "id": task_dir.name,
        "updatedAt": datetime.fromtimestamp(task_dir.stat().st_mtime).isoformat(),
        "createdAt": datetime.fromtimestamp(task_dir.stat().st_ctime).isoformat(),
        "hasAudio": (assets_dir / "playback.mp3").exists(),
        "assets": asset_names,
        "status": output.get("status") if isinstance(output, dict) else None,
        "requestId": task_result.get("request_id") if isinstance(task_result, dict) else None,
        "dataId": (create_output.get("dataId") if isinstance(create_output, dict) else None) or task_dir.name,
    }


def _build_viewer_profile_markdown(task_id: str, scenario: str, bundle: dict[str, Any]) -> str:
    assets = bundle.get("assets") if isinstance(bundle, dict) else {}
    summarization = assets.get("summarization") if isinstance(assets, dict) else {}
    meeting_assistance = assets.get("meetingAssistance") if isinstance(assets, dict) else {}
    transcription = assets.get("transcription") if isinstance(assets, dict) else {}
    keywords = meeting_assistance.get("keywords") if isinstance(meeting_assistance, dict) else []
    summary = summarization.get("paragraphSummary") if isinstance(summarization, dict) else ""
    paragraphs = transcription.get("paragraphs") if isinstance(transcription, dict) else []
    first_texts = []
    for paragraph in paragraphs[:6] if isinstance(paragraphs, list) else []:
        if isinstance(paragraph, dict):
            text = str(paragraph.get("text") or paragraph.get("sourceText") or "").strip()
            if text:
                first_texts.append(text)

    title = "CRM 客户拜访结构化画像" if scenario == "crm_visit" else "面试会话结构化画像"
    lines = [
        f"# {title}",
        "",
        f"- 录音任务：{task_id}",
        "- 来源：meeting-viewer 本地分析",
        "",
        "## 智能摘要",
        str(summary).strip() or "暂无可用摘要。",
        "",
        "## 关键词",
        "、".join(str(item) for item in keywords[:20]) if isinstance(keywords, list) and keywords else "暂无可用关键词。",
        "",
        "## 片段摘录",
    ]
    lines.extend(f"- {item}" for item in first_texts[:6])
    if not first_texts:
        lines.append("- 暂无可用转写片段。")
    lines.append("")
    return "\n".join(lines)


def _read_json_file(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _read_text_file(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _guess_content_type(path: Path) -> str:
    if path.suffix == ".js":
        return "application/javascript; charset=utf-8"
    if path.suffix == ".css":
        return "text/css; charset=utf-8"
    if path.suffix == ".html":
        return "text/html; charset=utf-8"
    if path.suffix == ".md":
        return "text/markdown; charset=utf-8"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _parse_range_header(range_header: str | None, file_size: int) -> tuple[int, int]:
    if not range_header:
        return 0, file_size - 1
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
    if not match:
        raise ValueError("Invalid range")
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        raise ValueError("Invalid range")
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise ValueError("Invalid range")
        start = max(file_size - suffix_length, 0)
        end = file_size - 1
    if start >= file_size or end < start:
        raise ValueError("Invalid range")
    return start, min(end, file_size - 1)


def _is_path_within(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def main() -> None:
    config = load_config()
    service = AudioService(config)
    try:
        server = ThreadingHTTPServer((config.host, config.port), create_handler(service))
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            print(
                f"[tongyi-audio-service] port {config.port} is already in use. "
                f"Open http://{config.host}:{config.port}/health to check the running service.",
                file=sys.stderr,
            )
            raise SystemExit(1) from None
        raise
    print(f"[tongyi-audio-service] listening on http://{config.host}:{config.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[tongyi-audio-service] stopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
