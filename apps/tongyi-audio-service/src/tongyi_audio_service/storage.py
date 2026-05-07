from __future__ import annotations

import hashlib
import json
import mimetypes
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import ServiceConfig
from .materializer import MaterializedRecording, materialize_recording
from .provider import ProviderError, now_iso, run_offline_task


TASK_STATUSES = {"queued", "running", "succeeded", "failed"}


def resolve_fixture_task_dir(config: ServiceConfig, fixture_task_id: str) -> Path:
    if config.fixture_output_dir.name == fixture_task_id:
        return config.fixture_output_dir
    return config.fixture_output_dir / fixture_task_id


@dataclass
class AudioFileMeta:
    file_name: str
    mime_type: str
    size: int
    md5: str
    local_path: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "fileName": self.file_name,
            "mimeType": self.mime_type,
            "size": self.size,
            "md5": self.md5,
            "localPath": self.local_path,
        }


@dataclass
class AudioTask:
    task_id: str
    status: str
    created_at: str
    updated_at: str
    provider: str = "tongyi-tingwu"
    provider_data_id: str | None = None
    fixture_task_id: str | None = None
    file: AudioFileMeta | None = None
    error_message: str | None = None
    material_path: str | None = None
    material_source: str | None = None
    anchors: dict[str, str] = field(default_factory=dict)

    def to_json(self, config: ServiceConfig) -> dict[str, Any]:
        task_dir = resolve_task_dir(self, config)
        playback_path = task_dir / "assets" / "playback.mp3" if task_dir else None
        return {
            "taskId": self.task_id,
            "provider": self.provider,
            "status": self.status,
            "providerDataId": self.provider_data_id,
            "fixtureTaskId": self.fixture_task_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "file": self.file.to_json() if self.file else None,
            "anchors": self.anchors,
            "stages": build_stages(self.status, bool(self.material_path)),
            "material": {
                "available": bool(self.material_path),
                "path": self.material_path,
                "source": self.material_source,
            },
            "playback": {
                "available": bool(playback_path and playback_path.exists()),
                "path": str(playback_path) if playback_path and playback_path.exists() else None,
            },
            "errorMessage": self.error_message,
        }


class TaskStore:
    def __init__(self, config: ServiceConfig):
        self.config = config
        self.task_dir = config.output_dir / "_tasks"
        self.upload_dir = config.output_dir / "_uploads"
        self.lock = threading.Lock()
        self.tasks: dict[str, AudioTask] = {}
        self.file_hash_index: dict[str, str] = {}
        self._ensure_dirs()
        self._load_tasks()

    def create_fixture_task(
        self,
        fixture_task_id: str,
        *,
        anchors: dict[str, str] | None = None,
        source_file_name: str | None = None,
    ) -> AudioTask:
        fixture_task_id = fixture_task_id.strip()
        if not fixture_task_id:
            raise ValueError("fixtureTaskId is required")
        fixture_dir = resolve_fixture_task_dir(self.config, fixture_task_id)
        if not fixture_dir.exists():
            raise FileNotFoundError(f"Fixture task not found: {fixture_task_id}")
        now = now_iso()
        task = AudioTask(
            task_id=f"audio-task-{uuid4().hex[:12]}",
            status="succeeded",
            created_at=now,
            updated_at=now,
            provider_data_id=fixture_task_id,
            fixture_task_id=fixture_task_id,
            anchors=normalize_anchors(anchors),
            file=AudioFileMeta(
                file_name=source_file_name or f"{fixture_task_id}.fixture",
                mime_type="application/octet-stream",
                size=0,
                md5=hashlib.md5(fixture_task_id.encode("utf-8")).hexdigest(),
            ),
        )
        self._save_task(task)
        return task

    def create_upload_task(
        self,
        *,
        file_name: str,
        mime_type: str,
        content: bytes,
        anchors: dict[str, str] | None = None,
    ) -> AudioTask:
        digest = hashlib.md5(content).hexdigest()
        suffix = Path(file_name).suffix or mimetypes.guess_extension(mime_type) or ".audio"
        local_path = self.upload_dir / f"{digest}{suffix}"
        with self.lock:
            existing_task_id = self.file_hash_index.get(digest)
            if existing_task_id and existing_task_id in self.tasks:
                existing_task = self.tasks[existing_task_id]
                if existing_task.status != "failed":
                    return existing_task
                existing_task.status = "queued"
                existing_task.error_message = None
                existing_task.material_path = None
                existing_task.material_source = None
                existing_task.anchors = normalize_anchors(anchors) or existing_task.anchors
                if existing_task.file:
                    existing_task.file.file_name = file_name or existing_task.file.file_name
                    existing_task.file.mime_type = mime_type or existing_task.file.mime_type
                    existing_task.file.size = len(content)
                    existing_task.file.local_path = existing_task.file.local_path or str(local_path)
                existing_task.updated_at = now_iso()
                task = existing_task
                restart_existing = True
            else:
                restart_existing = False

        local_path.parent.mkdir(parents=True, exist_ok=True)
        if not local_path.exists():
            local_path.write_bytes(content)

        if restart_existing:
            self._save_task(task)
            self._start_background_provider(task, Path(task.file.local_path) if task.file and task.file.local_path else local_path)
            return task

        now = now_iso()
        task = AudioTask(
            task_id=f"audio-task-{uuid4().hex[:12]}",
            status="queued",
            created_at=now,
            updated_at=now,
            anchors=normalize_anchors(anchors),
            file=AudioFileMeta(
                file_name=file_name,
                mime_type=mime_type or "application/octet-stream",
                size=len(content),
                md5=digest,
                local_path=str(local_path),
            ),
        )
        self._save_task(task)
        self._start_background_provider(task, local_path)
        return task

    def get_task(self, task_id: str) -> AudioTask:
        with self.lock:
            task = self.tasks.get(task_id)
        if not task:
            raise KeyError(task_id)
        return task

    def materialize(
        self,
        task_id: str,
        *,
        preferred_source: str = "auto",
        anchors: dict[str, str] | None = None,
    ) -> tuple[AudioTask, MaterializedRecording]:
        task = self.get_task(task_id)
        if task.status != "succeeded":
            raise RuntimeError("Only succeeded tasks can be materialized")
        task_dir = resolve_task_dir(task, self.config)
        if task_dir is None or not task_dir.exists():
            raise FileNotFoundError("Task output directory not found")

        merged_anchors = {**task.anchors, **normalize_anchors(anchors)}
        material = materialize_recording(
            task.provider_data_id or task.fixture_task_id or task.task_id,
            task_dir,
            preferred_source=preferred_source,
            anchors=merged_anchors,
            source_file_name=task.file.file_name if task.file else None,
        )
        material_path = task_dir / material.file_name
        material_path.write_text(material.markdown, encoding="utf-8")
        task.material_path = str(material_path)
        task.material_source = material.source
        task.anchors = merged_anchors
        task.updated_at = now_iso()
        self._save_task(task)
        return task, material

    def _start_background_provider(self, task: AudioTask, local_path: Path) -> None:
        if not self.config.provider_configured:
            task.status = "failed"
            task.error_message = "缺少 TONGYI_DASHSCOPE_API_KEY/DASHSCOPE_API_KEY 或 TONGYI_TINGWU_APP_ID/TINGWU_APP_ID，无法创建真实录音处理任务。"
            task.updated_at = now_iso()
            self._save_task(task)
            return

        def run() -> None:
            self._update_task(task.task_id, status="running", error_message=None)
            try:
                data_id = run_offline_task(
                    audio_path=local_path,
                    app_id=self.config.tingwu_app_id or "",
                    api_key=self.config.dashscope_api_key or "",
                    output_dir=self.config.output_dir,
                    task_dir_name=task.file.md5 if task.file else None,
                    poll_interval_seconds=self.config.poll_interval_seconds,
                    timeout_seconds=self.config.task_timeout_seconds,
                )
                self._update_task(task.task_id, status="succeeded", provider_data_id=data_id, error_message=None)
            except (ProviderError, TimeoutError, RuntimeError, OSError) as error:
                self._update_task(task.task_id, status="failed", error_message=str(error))

        thread = threading.Thread(target=run, name=f"tongyi-audio-{task.task_id}", daemon=True)
        thread.start()

    def _update_task(self, task_id: str, **updates: Any) -> None:
        with self.lock:
            task = self.tasks[task_id]
            for key, value in updates.items():
                setattr(task, key, value)
            task.updated_at = now_iso()
        self._save_task(task)

    def _save_task(self, task: AudioTask) -> None:
        self.task_dir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            self.tasks[task.task_id] = task
            if task.file:
                self.file_hash_index[task.file.md5] = task.task_id
        (self.task_dir / f"{task.task_id}.json").write_text(
            json.dumps(task_to_dict(task), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_tasks(self) -> None:
        if not self.task_dir.exists():
            return
        for path in self.task_dir.glob("*.json"):
            try:
                task = task_from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                continue
            self.tasks[task.task_id] = task
            if task.file:
                self.file_hash_index[task.file.md5] = task.task_id

    def _ensure_dirs(self) -> None:
        self.config.output_dir.mkdir(parents=True, exist_ok=True)
        self.task_dir.mkdir(parents=True, exist_ok=True)
        self.upload_dir.mkdir(parents=True, exist_ok=True)


def resolve_task_dir(task: AudioTask, config: ServiceConfig) -> Path | None:
    if task.fixture_task_id:
        return resolve_fixture_task_dir(config, task.fixture_task_id)
    if task.file and task.file.md5:
        md5_dir = config.output_dir / task.file.md5
        if md5_dir.exists():
            return md5_dir
    if task.provider_data_id:
        return config.output_dir / task.provider_data_id
    return None


def build_stages(status: str, has_material: bool) -> list[dict[str, str]]:
    labels = [
        ("uploaded", "已上传"),
        ("summary", "生成摘要"),
        ("chapters", "生成章节"),
        ("keywords", "提取关键词"),
        ("speakers", "识别说话人"),
        ("material", "生成资料包"),
    ]
    stages: list[dict[str, str]] = []
    for key, label in labels:
        stage_status = "pending"
        if status == "failed":
            stage_status = "failed" if key != "uploaded" else "succeeded"
        elif status == "succeeded":
            stage_status = "succeeded" if key != "material" or has_material else "pending"
        elif status == "running":
            stage_status = "running" if key != "uploaded" else "succeeded"
        elif status == "queued":
            stage_status = "pending" if key != "uploaded" else "succeeded"
        stages.append({"key": key, "label": label, "status": stage_status})
    return stages


def normalize_anchors(anchors: dict[str, str] | None) -> dict[str, str]:
    if not anchors:
        return {}
    normalized: dict[str, str] = {}
    for key in ("customer", "opportunity", "followup"):
        value = str(anchors.get(key) or "").strip()
        if value:
            normalized[key] = value
    return normalized


def task_to_dict(task: AudioTask) -> dict[str, Any]:
    return {
        "taskId": task.task_id,
        "provider": task.provider,
        "status": task.status,
        "providerDataId": task.provider_data_id,
        "fixtureTaskId": task.fixture_task_id,
        "createdAt": task.created_at,
        "updatedAt": task.updated_at,
        "file": task.file.to_json() if task.file else None,
        "errorMessage": task.error_message,
        "materialPath": task.material_path,
        "materialSource": task.material_source,
        "anchors": task.anchors,
    }


def task_from_dict(payload: dict[str, Any]) -> AudioTask:
    file_payload = payload.get("file")
    file_meta = None
    if isinstance(file_payload, dict):
        file_meta = AudioFileMeta(
            file_name=str(file_payload.get("fileName") or ""),
            mime_type=str(file_payload.get("mimeType") or "application/octet-stream"),
            size=int(file_payload.get("size") or 0),
            md5=str(file_payload.get("md5") or file_payload.get("sha256") or ""),
            local_path=file_payload.get("localPath"),
        )
    status = str(payload.get("status") or "failed")
    if status not in TASK_STATUSES:
        status = "failed"
    return AudioTask(
        task_id=str(payload["taskId"]),
        status=status,
        provider=str(payload.get("provider") or "tongyi-tingwu"),
        provider_data_id=payload.get("providerDataId"),
        fixture_task_id=payload.get("fixtureTaskId"),
        created_at=str(payload.get("createdAt") or now_iso()),
        updated_at=str(payload.get("updatedAt") or now_iso()),
        file=file_meta,
        error_message=payload.get("errorMessage"),
        material_path=payload.get("materialPath"),
        material_source=payload.get("materialSource"),
        anchors=normalize_anchors(payload.get("anchors") if isinstance(payload.get("anchors"), dict) else None),
    )
