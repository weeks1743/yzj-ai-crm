from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parents[1]


@dataclass(frozen=True)
class ServiceConfig:
    host: str
    port: int
    dashscope_api_key: str | None
    tingwu_app_id: str | None
    output_dir: Path
    fixture_output_dir: Path
    poll_interval_seconds: int
    task_timeout_seconds: int

    @property
    def provider_configured(self) -> bool:
        return bool(self.dashscope_api_key and self.tingwu_app_id)


def _positive_int(value: str | None, fallback: int, label: str) -> int:
    if not value:
        return fallback
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{label} must be a positive integer") from error
    if parsed <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return parsed


def _resolve_path(value: str | None, fallback: Path) -> Path:
    if not value:
        return fallback.resolve()
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path.resolve()


def load_config(env: dict[str, str] | None = None) -> ServiceConfig:
    source = env if env is not None else os.environ
    output_dir = _resolve_path(
        source.get("TONGYI_AUDIO_OUTPUT_DIR"),
        REPO_ROOT / "tmp" / "tongyi",
    )
    fixture_output_dir = _resolve_path(
        source.get("TONGYI_AUDIO_FIXTURE_OUTPUT_DIR"),
        output_dir,
    )

    return ServiceConfig(
        host=source.get("TONGYI_AUDIO_SERVICE_HOST") or "127.0.0.1",
        port=_positive_int(source.get("TONGYI_AUDIO_SERVICE_PORT"), 3018, "TONGYI_AUDIO_SERVICE_PORT"),
        dashscope_api_key=(
            source.get("TONGYI_DASHSCOPE_API_KEY")
            or source.get("DASHSCOPE_API_KEY")
            or ""
        ).strip() or None,
        tingwu_app_id=(
            source.get("TONGYI_TINGWU_APP_ID")
            or source.get("TINGWU_APP_ID")
            or ""
        ).strip() or None,
        output_dir=output_dir,
        fixture_output_dir=fixture_output_dir,
        poll_interval_seconds=_positive_int(
            source.get("TONGYI_AUDIO_POLL_INTERVAL_SECONDS"),
            10,
            "TONGYI_AUDIO_POLL_INTERVAL_SECONDS",
        ),
        task_timeout_seconds=_positive_int(
            source.get("TONGYI_AUDIO_TASK_TIMEOUT_SECONDS"),
            1800,
            "TONGYI_AUDIO_TASK_TIMEOUT_SECONDS",
        ),
    )
