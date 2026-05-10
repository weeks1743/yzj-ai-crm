from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROCESS_ONLY_FILES = {
    "transcription.json",
    "translations.json",
    "textPolish.json",
    "task-result.json",
    "create-task.json",
    "summary.txt",
}

@dataclass(frozen=True)
class MaterializedRecording:
    task_id: str
    markdown: str
    file_name: str
    source: str
    source_path: Path | None
    excluded_process_files: tuple[str, ...]


def materialize_recording(
    task_id: str,
    task_dir: Path,
    *,
    preferred_source: str = "auto",
    anchors: dict[str, str] | None = None,
    source_file_name: str | None = None,
) -> MaterializedRecording:
    normalized_source = preferred_source if preferred_source in {"auto", "generated", "profile_analysis"} else "auto"
    profile_markdown = find_profile_markdown(task_dir)
    profile_text = ""
    if profile_markdown is not None:
        profile_text = profile_markdown.read_text(encoding="utf-8").strip()

    if normalized_source == "profile_analysis" and profile_text:
        return MaterializedRecording(
            task_id=task_id,
            markdown=normalize_profile_markdown(profile_text, task_id, anchors),
            file_name="recording-material.md",
            source="profile_analysis",
            source_path=profile_markdown,
            excluded_process_files=tuple(sorted(PROCESS_ONLY_FILES)),
        )

    if normalized_source == "auto" and not has_standard_material_inputs(task_dir) and profile_text:
        return MaterializedRecording(
            task_id=task_id,
            markdown=normalize_profile_markdown(profile_text, task_id, anchors),
            file_name="recording-material.md",
            source="profile_analysis",
            source_path=profile_markdown,
            excluded_process_files=tuple(sorted(PROCESS_ONLY_FILES)),
        )

    markdown = build_standard_material_markdown(
        task_id=task_id,
        task_dir=task_dir,
        anchors=anchors or {},
        source_file_name=source_file_name,
        profile_markdown=profile_text,
    )
    return MaterializedRecording(
        task_id=task_id,
        markdown=markdown,
        file_name="recording-material.md",
        source="generated",
        source_path=None,
        excluded_process_files=tuple(sorted(PROCESS_ONLY_FILES)),
    )


def find_profile_markdown(task_dir: Path) -> Path | None:
    profile_dir = task_dir / "profile-analysis"
    if not profile_dir.exists():
        return None
    markdown_files = sorted(
        profile_dir.glob("*.md"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    crm_files = [item for item in markdown_files if item.name.startswith("crm_visit")]
    return (crm_files or markdown_files)[0] if markdown_files else None


def normalize_profile_markdown(
    markdown: str,
    task_id: str,
    anchors: dict[str, str] | None,
) -> str:
    header = [
        "# 录音资料包",
        "",
        "> 资料边界：本 Markdown 是对话检索的默认录音资料；原始转写、翻译、润色等过程文件已排除。",
        "",
        "## 基本信息",
        f"- 录音任务：{task_id}",
        *_anchor_lines(anchors or {}),
        "",
        "## 客户录音分析",
        "",
    ]
    body = strip_markdown_title(markdown)
    return "\n".join(header).rstrip() + "\n\n" + body + "\n"


def build_standard_material_markdown(
    *,
    task_id: str,
    task_dir: Path,
    anchors: dict[str, str],
    source_file_name: str | None,
    profile_markdown: str = "",
) -> str:
    assets_dir = task_dir / "assets"
    summarization = _merge_summarization_mindmap(
        _read_json(assets_dir / "summarization.json") or {},
        _read_json(assets_dir / "mindMapSummary.json") or {},
    )
    meeting_assistance = _read_json(assets_dir / "meetingAssistance.json") or {}
    auto_chapters = _read_json(assets_dir / "autoChapters.json") or []

    lines: list[str] = [
        "# 录音资料包",
        "",
        "> 资料边界：本 Markdown 是对话检索的默认录音资料；下游技能可按白名单读取通义结构化分析文件，原始转写、翻译、润色等过程文件已排除。",
        "",
        "## 基本信息",
        f"- 录音任务：{task_id}",
        f"- 生成时间：{datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')}",
    ]
    if source_file_name:
        lines.append(f"- 来源文件：{source_file_name}")
    lines.extend(_anchor_lines(anchors))

    lines.extend(["", "## 会话摘要"])
    summary_items = _conversation_summary(summarization)
    if summary_items:
        lines.extend(f"- {item}" for item in summary_items)
    else:
        lines.append("- 暂无可用会话摘要。")

    lines.extend(["", "## 关键主题"])
    topics = _mindmap_topics(summarization)
    if topics:
        lines.extend(f"- {topic}" for topic in topics[:12])
    else:
        lines.append("- 暂无可用主题。")

    lines.extend(["", "## 关键词"])
    keywords = _keywords(meeting_assistance)
    lines.append("、".join(keywords[:20]) if keywords else "暂无可用关键词。")

    lines.extend(["", "## 自动章节"])
    chapters = _chapters(auto_chapters)
    if chapters:
        for index, chapter in enumerate(chapters[:20], start=1):
            time_range = _chapter_time_range(chapter)
            headline = str(chapter.get("headline") or chapter.get("title") or f"章节 {index}").strip()
            summary = str(chapter.get("summary") or "").strip()
            lines.append(f"{index}. {time_range}{headline}")
            if summary:
                lines.append(f"   - {summary}")
    else:
        lines.append("暂无可用章节。")

    lines.extend([
        "",
        "## 后续动作建议",
        "- 可基于本资料包继续执行拜访会话理解、客户需求工作待办分析、客户价值定位。",
        "- 可基于本资料包新增拜访记录；正式写入前必须补齐客户与商机，并等待用户确认。",
        "- 当前资料包不展示逐字内容，必要时可在录音查看页中回放录音核对。",
        "",
    ])

    profile_body = strip_markdown_title(profile_markdown)
    if profile_body:
        lines.extend([
            "## 客户录音分析",
            "",
            profile_body,
            "",
        ])

    return "\n".join(lines)


def has_standard_material_inputs(task_dir: Path) -> bool:
    assets_dir = task_dir / "assets"
    summarization = _merge_summarization_mindmap(
        _read_json(assets_dir / "summarization.json") or {},
        _read_json(assets_dir / "mindMapSummary.json") or {},
    )
    meeting_assistance = _read_json(assets_dir / "meetingAssistance.json") or {}
    auto_chapters = _read_json(assets_dir / "autoChapters.json") or []
    return bool(
        _conversation_summary(summarization)
        or _mindmap_topics(summarization)
        or _keywords(meeting_assistance)
        or _chapters(auto_chapters)
    )


def strip_markdown_title(markdown: str) -> str:
    body = markdown.strip()
    if body.startswith("# "):
        body = body.split("\n", 1)[1].strip() if "\n" in body else body[2:].strip()
    return body


def _read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _merge_summarization_mindmap(summarization: Any, mindmap: Any) -> Any:
    if not isinstance(summarization, dict):
        summarization = {}
    if summarization.get("mindMapSummary"):
        return summarization
    if isinstance(mindmap, dict) and mindmap.get("mindMapSummary"):
        return {**summarization, "mindMapSummary": mindmap.get("mindMapSummary")}
    if isinstance(mindmap, list) and mindmap:
        return {**summarization, "mindMapSummary": mindmap}
    return summarization


def _anchor_lines(anchors: dict[str, str]) -> list[str]:
    labels = {
        "customer": "关联客户",
        "opportunity": "关联商机",
        "followup": "关联跟进记录",
    }
    lines: list[str] = []
    for key in ("customer", "opportunity", "followup"):
        value = str(anchors.get(key) or "").strip()
        if value:
            lines.append(f"- {labels[key]}：{value}")
    if not lines:
        lines.append("- 关联状态：未关联客户/商机，可先处理、稍后补齐。")
    return lines


def _conversation_summary(payload: Any) -> list[str]:
    items = []
    for item in _as_list(_get(payload, "conversationalSummary")):
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speakerName") or item.get("speakerId") or "发言人").strip()
        summary = str(item.get("summary") or "").strip()
        if summary:
            items.append(f"{speaker}：{summary}")
    paragraph_summary = _get(payload, "paragraphSummary")
    if isinstance(paragraph_summary, str) and paragraph_summary.strip():
        items.append(paragraph_summary.strip())
    return items


def _mindmap_topics(payload: Any) -> list[str]:
    topics: list[str] = []

    def visit(node: Any, depth: int = 0) -> None:
        if len(topics) >= 16:
            return
        if isinstance(node, dict):
            title = str(node.get("title") or "").strip()
            if title:
                topics.append(("  " * min(depth, 2)) + title)
            for child in _as_list(node.get("topic")):
                visit(child, depth + 1)
        elif isinstance(node, list):
            for child in node:
                visit(child, depth)

    visit(_get(payload, "mindMapSummary"))
    return topics


def _keywords(payload: Any) -> list[str]:
    raw = _get(payload, "keywords")
    return [str(item).strip() for item in _as_list(raw) if str(item).strip()]


def _chapters(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        return [item for item in payload.values() if isinstance(item, dict)]
    return []


def _chapter_time_range(chapter: dict[str, Any]) -> str:
    start = _format_ms(chapter.get("start"))
    end = _format_ms(chapter.get("end"))
    if start or end:
        return f"[{start or '00:00'}-{end or '--:--'}] "
    return ""


def _format_ms(value: Any) -> str:
    try:
        milliseconds = int(value)
    except (TypeError, ValueError):
        return ""
    total_seconds = max(0, milliseconds // 1000)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _get(payload: Any, key: str) -> Any:
    return payload.get(key) if isinstance(payload, dict) else None


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []
