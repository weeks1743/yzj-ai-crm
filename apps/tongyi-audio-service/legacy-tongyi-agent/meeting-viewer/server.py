import json
import mimetypes
import os
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUTS_DIR = ROOT_DIR / "outputs"
HOST = "127.0.0.1"
PORT = 8123
RANGE_CHUNK_SIZE = 64 * 1024
PROFILE_DIR_NAME = "profile-analysis"


def json_response(handler: SimpleHTTPRequestHandler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def task_meta(task_dir: Path):
    assets_dir = task_dir / "assets"
    create_task = read_json(task_dir / "create-task.json") or {}
    task_result = read_json(task_dir / "task-result.json") or {}

    asset_names = []
    if assets_dir.exists():
        asset_names = sorted(
            path.name for path in assets_dir.iterdir() if path.is_file()
        )

    return {
        "id": task_dir.name,
        "updatedAt": datetime.fromtimestamp(task_dir.stat().st_mtime).isoformat(),
        "createdAt": datetime.fromtimestamp(task_dir.stat().st_ctime).isoformat(),
        "hasAudio": (assets_dir / "playback.mp3").exists(),
        "assets": asset_names,
        "status": ((task_result.get("output") or {}).get("status")),
        "requestId": task_result.get("request_id"),
        "dataId": ((create_task.get("output") or {}).get("dataId")) or task_dir.name,
    }


def list_tasks():
    if not OUTPUTS_DIR.exists():
        return []
    tasks = [task_meta(path) for path in OUTPUTS_DIR.iterdir() if path.is_dir()]
    tasks.sort(key=lambda item: item["updatedAt"], reverse=True)
    return tasks


def load_task_bundle(task_id: str):
    task_dir = OUTPUTS_DIR / task_id
    if not task_dir.exists():
        return None

    assets_dir = task_dir / "assets"
    bundle = {
        "id": task_id,
        "meta": task_meta(task_dir),
        "createTask": read_json(task_dir / "create-task.json"),
        "taskResult": read_json(task_dir / "task-result.json"),
        "summaryText": (task_dir / "summary.txt").read_text(encoding="utf-8")
        if (task_dir / "summary.txt").exists()
        else "",
        "assets": {
            "transcription": read_json(assets_dir / "transcription.json"),
            "translations": read_json(assets_dir / "translations.json"),
            "textPolish": read_json(assets_dir / "textPolish.json"),
            "summarization": read_json(assets_dir / "summarization.json"),
            "meetingAssistance": read_json(assets_dir / "meetingAssistance.json"),
            "autoChapters": read_json(assets_dir / "autoChapters.json"),
            "pptExtraction": read_json(assets_dir / "pptExtraction.json"),
        },
        "media": {
            "playbackUrl": f"/outputs/{task_id}/assets/playback.mp3"
            if (assets_dir / "playback.mp3").exists()
            else None,
        },
    }
    return bundle


def speaker_raw_label(speaker_id: str) -> str:
    return f"发言人{speaker_id}"


def apply_speaker_aliases(text: str, aliases: dict[str, str]) -> str:
    output = text
    for raw_label, alias in aliases.items():
        if not raw_label or not alias:
            continue
        output = output.replace(raw_label, alias)
    return output


def extract_sentence_candidates(text: str) -> list[str]:
    normalized = (
        text.replace("？", "。\n")
        .replace("！", "。\n")
        .replace("。", "。\n")
        .replace("\n\n", "\n")
    )
    return [line.strip() for line in normalized.splitlines() if line.strip()]


def infer_interview_role(text: str, speaker_index: int, all_text: str) -> str:
    if any(keyword in text for keyword in ["毕业", "加入", "负责", "项目", "经历", "我在", "做过"]):
        return "候选人"
    if any(keyword in text for keyword in ["你好", "请你", "你能", "我们今天", "方便介绍", "为什么"]):
        return "面试官 / 评估方"
    return "候选人" if speaker_index == 0 else "面试官 / 评估方"


def infer_crm_role(text: str, speaker_index: int) -> str:
    if any(keyword in text for keyword in ["我们最怕", "希望", "担心", "预算", "总部", "审批", "内部"]):
        return "客户侧关键参与人"
    if any(keyword in text for keyword in ["方案", "试点", "落地", "推进", "建议", "系统", "我们这边"]):
        return "我方销售 / 顾问"
    return "客户侧关键参与人" if speaker_index == 0 else "我方销售 / 顾问"


def derive_tags(text: str, scenario: str, bundle: dict) -> list[str]:
    keywords = list((bundle.get("assets", {}).get("meetingAssistance") or {}).get("keywords") or [])
    matched = [keyword for keyword in keywords if keyword and keyword in text][:4]
    if matched:
        return matched

    fallback_map = {
        "interview": ["经历表达", "项目复盘", "沟通清晰", "岗位匹配"],
        "crm_visit": ["需求表达", "预算敏感", "决策关注", "推进风险"],
    }
    return fallback_map[scenario]


def infer_interview_profile(text: str, speaker_index: int, bundle: dict) -> dict:
    role = infer_interview_role(text, speaker_index, text)
    tags = derive_tags(text, "interview", bundle)
    communication = "表达完整、偏叙述式" if len(text) > 220 else "表达直接、偏简洁"
    if "？" in text or "?" in text:
        communication = "提问驱动、节奏较强"

    motivations = []
    if any(keyword in text for keyword in ["成长", "发展", "机会", "岗位"]):
        motivations.append("关注岗位成长与职业发展")
    if any(keyword in text for keyword in ["项目", "负责", "落地"]):
        motivations.append("关注项目负责度与落地空间")
    if not motivations:
        motivations.append("关注岗位匹配度与实际业务场景")

    strengths = []
    if any(keyword in text for keyword in ["负责", "主导", "带领"]):
        strengths.append("具备项目负责或牵引经验")
    if any(keyword in text for keyword in ["分析", "规划", "架构", "设计"]):
        strengths.append("在分析、设计或规划表达上较清晰")
    if not strengths:
        strengths.append("表达相对完整，能持续输出上下文")

    risks = []
    if any(keyword in text for keyword in ["可能", "大概", "相对", "应该"]):
        risks.append("部分表述偏概括，细节量化证据可继续追问")
    if not risks:
        risks.append("建议结合追问进一步校验结论与案例细节")

    advice = "继续围绕具体项目、职责边界与结果数据追问，以便形成更稳的面试判断。"

    return {
        "role": role,
        "tags": tags,
        "communication": communication,
        "focus": "；".join(motivations),
        "strengths": "；".join(strengths),
        "risks": "；".join(risks),
        "advice": advice,
    }


def infer_crm_profile(text: str, speaker_index: int, bundle: dict) -> dict:
    role = infer_crm_role(text, speaker_index)
    tags = derive_tags(text, "crm_visit", bundle)
    influence = "高" if any(keyword in text for keyword in ["预算", "审批", "总部", "CEO", "决策"]) else ("中" if any(keyword in text for keyword in ["需求", "方案", "试点"]) else "低")
    attitude = "谨慎" if any(keyword in text for keyword in ["担心", "风险", "顾虑", "怕"]) else ("积极" if any(keyword in text for keyword in ["希望", "推进", "愿意", "可以"]) else "中性")
    concerns = []
    if any(keyword in text for keyword in ["预算", "投入", "ROI", "成本"]):
        concerns.append("对预算投入与回报敏感")
    if any(keyword in text for keyword in ["审批", "合规", "权限", "总部"]):
        concerns.append("关注审批、权限或合规要求")
    if any(keyword in text for keyword in ["试点", "周期", "落地", "集成"]):
        concerns.append("关注试点周期、落地成本或集成复杂度")
    if not concerns:
        concerns.append("关注业务问题解决路径与推进节奏")

    preference = "更容易接受低风险、可试点、可分阶段推进的沟通方式。"
    follow_up = "后续建议围绕其核心关注点准备针对性材料，并在下一轮沟通中确认其在决策链中的实际影响力。"

    return {
        "role": role,
        "influence": influence,
        "attitude": attitude,
        "tags": tags,
        "focus": "；".join(concerns),
        "risks": "；".join(concerns[:2]),
        "preference": preference,
        "advice": follow_up,
    }


def build_profile_prompt(scenario: str, transcript: str, speaker_aliases: dict[str, str]) -> str:
    alias_lines = "\n".join(f"- {key} => {value}" for key, value in speaker_aliases.items() if value.strip())
    alias_block = f"\n【发言人映射】\n{alias_lines}\n" if alias_lines else ""
    if scenario == "interview":
        return f"""你是一位资深面试分析顾问，请基于下面的面试录音转写内容，为每位发言人输出结构化人物画像，要求严格使用 Markdown。

目标：
1. 识别每位发言人的身份角色
2. 归纳其能力亮点、沟通风格、关注点与潜在风险
3. 所有结论必须基于录音内容
4. 输出应适合直接生成图片卡片或人物画像面板

每位发言人输出字段：
- 角色判断
- 核心标签
- 沟通风格
- 动机偏好
- 能力亮点
- 风险提示
- 面试建议
- 证据摘录
{alias_block}
转写内容：
{transcript}"""

    return f"""你是一位资深 B2B 销售顾问，请基于下面的客户拜访录音转写，为每位发言人输出结构化人物画像，要求严格使用 Markdown。

目标：
1. 判断客户拜访中每位发言人的角色、影响力和态度
2. 提炼其关注点、顾虑点与偏好沟通方式
3. 给出后续跟进建议
4. 所有结论必须基于录音内容

每位发言人输出字段：
- 角色 / 职能判断
- 决策影响力
- 当前态度
- 核心关注点
- 潜在顾虑
- 偏好沟通方式
- 跟进建议
- 证据摘录
{alias_block}
转写内容：
{transcript}"""


def build_profile_markdown(task_id: str, scenario: str, bundle: dict, speaker_aliases: dict[str, str]) -> tuple[str, list[str]]:
    transcription = (bundle.get("assets") or {}).get("transcription") or {}
    paragraphs = transcription.get("paragraphs") or []
    by_speaker: dict[str, list[str]] = {}

    for paragraph in paragraphs:
        speaker_id = str(paragraph.get("speakerId") or "")
        if not speaker_id:
            continue
        label = speaker_raw_label(speaker_id)
        paragraph_text = "".join(word.get("text", "") for word in paragraph.get("words") or [])
        by_speaker.setdefault(label, []).append(paragraph_text)

    speaker_labels = list(by_speaker.keys())
    aliased_transcript = apply_speaker_aliases(
        "\n".join(f"{label}: {' '.join(lines)}" for label, lines in by_speaker.items()),
        speaker_aliases,
    )
    prompt = build_profile_prompt(scenario, aliased_transcript, speaker_aliases)

    title = "面试结构化画像" if scenario == "interview" else "CRM 客户拜访结构化画像"
    sections = [f"# {title}", "", f"> 任务：`{task_id}`", ""]

    for index, raw_label in enumerate(speaker_labels):
        text = "\n".join(by_speaker[raw_label])
        display_name = speaker_aliases.get(raw_label, raw_label)
        evidence = extract_sentence_candidates(text)[:3]
        profile = (
            infer_interview_profile(text, index, bundle)
            if scenario == "interview"
            else infer_crm_profile(text, index, bundle)
        )

        sections.extend(
            [
                f"## {display_name}",
                f"- 原始发言人：{raw_label}",
                f"- 角色判断：{profile['role']}",
                f"- 核心标签：{'、'.join(profile['tags'])}",
                f"- 沟通风格：{profile['communication'] if scenario == 'interview' else '表达围绕业务问题推进，信息点较集中'}",
                f"- {'动机偏好' if scenario == 'interview' else '核心关注点'}：{profile['focus']}",
                f"- {'能力亮点' if scenario == 'interview' else '潜在顾虑'}：{profile['strengths'] if scenario == 'interview' else profile['risks']}",
                f"- {'风险提示' if scenario == 'interview' else '决策影响力'}：{profile['risks'] if scenario == 'interview' else profile['influence']}",
                f"- {'面试建议' if scenario == 'interview' else '当前态度'}：{profile['advice'] if scenario == 'interview' else profile['attitude']}",
                f"- {'证据摘录' if scenario == 'interview' else '偏好沟通方式'}：",
            ]
        )

        if scenario != "interview":
            sections.append(f"  - {profile['preference']}")

        for sentence in evidence or ["暂无可提取证据摘录。"]:
            sections.append(f"  - {sentence}")
        if scenario != "interview":
            sections.append(f"- 跟进建议：{profile['advice']}")
        sections.append("")

    return "\n".join(sections).strip() + "\n", [prompt, *speaker_labels]


def save_profile_markdown(task_id: str, scenario: str, content: str) -> str:
    profile_dir = OUTPUTS_DIR / task_id / PROFILE_DIR_NAME
    profile_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{scenario}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    path = profile_dir / file_name
    path.write_text(content, encoding="utf-8")
    return f"/outputs/{task_id}/{PROFILE_DIR_NAME}/{file_name}"


class ViewerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/tasks":
            return json_response(self, {"tasks": list_tasks()})

        if parsed.path.startswith("/api/task/"):
            task_id = parsed.path.rsplit("/", 1)[-1]
            bundle = load_task_bundle(task_id)
            if bundle is None:
                return json_response(self, {"error": "Task not found"}, status=404)
            return json_response(self, bundle)

        if self._should_handle_with_range(parsed.path):
            return self._serve_file_with_range(send_body=True)

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/task/") and parsed.path.endswith("/profile-analysis"):
            task_id = parsed.path.split("/")[3]
            bundle = load_task_bundle(task_id)
            if bundle is None:
                return json_response(self, {"error": "Task not found"}, status=404)

            try:
                payload = self._read_json_body()
            except ValueError as error:
                return json_response(self, {"error": str(error)}, status=400)

            scenario = payload.get("scenario") or "interview"
            speaker_aliases = payload.get("speaker_aliases") or {}
            if scenario not in {"interview", "crm_visit"}:
                return json_response(self, {"error": "Invalid scenario"}, status=400)

            markdown, prompt_parts = build_profile_markdown(
                task_id=task_id,
                scenario=scenario,
                bundle=bundle,
                speaker_aliases=speaker_aliases,
            )
            markdown_url = save_profile_markdown(task_id, scenario, markdown)
            prompt = prompt_parts[0]
            speakers = prompt_parts[1:]

            return json_response(
                self,
                {
                    "taskId": task_id,
                    "scenario": scenario,
                    "prompt": prompt,
                    "markdown": markdown,
                    "markdownUrl": markdown_url,
                    "detectedSpeakers": speakers,
                    "appliedAliases": speaker_aliases,
                },
            )

        return json_response(self, {"error": "Not found"}, status=404)

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if self._should_handle_with_range(parsed.path):
            return self._serve_file_with_range(send_body=False)
        return super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def _should_handle_with_range(self, path: str) -> bool:
        return path.startswith("/outputs/") and path.endswith(".mp3")

    def _serve_file_with_range(self, send_body: bool):
        path = Path(self.translate_path(self.path))
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        file_size = path.stat().st_size
        range_header = self.headers.get("Range")
        ctype = self.guess_type(str(path))

        try:
            start, end = self._parse_range_header(range_header, file_size)
        except ValueError:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", "0")
            self.send_header("Content-Type", ctype)
            self.end_headers()
            return None

        content_length = end - start + 1
        status = (
            HTTPStatus.PARTIAL_CONTENT
            if range_header is not None
            else HTTPStatus.OK
        )

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        self.send_header("Last-Modified", self.date_time_string(path.stat().st_mtime))
        if range_header is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        if not send_body:
            return None

        with path.open("rb") as file_obj:
            file_obj.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = file_obj.read(min(RANGE_CHUNK_SIZE, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        return None

    def _parse_range_header(self, header_value: str, file_size: int):
        if not header_value:
            return 0, file_size - 1

        if not header_value.startswith("bytes="):
            raise ValueError("Unsupported range unit")

        byte_range = header_value.split("=", 1)[1].strip()
        if "," in byte_range:
            raise ValueError("Multiple ranges not supported")

        start_str, end_str = byte_range.split("-", 1)
        if not start_str and not end_str:
            raise ValueError("Invalid range")

        if start_str:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
        else:
            suffix_length = int(end_str)
            if suffix_length <= 0:
                raise ValueError("Invalid suffix range")
            if suffix_length >= file_size:
                start = 0
            else:
                start = file_size - suffix_length
            end = file_size - 1

        if start < 0 or end < start or start >= file_size:
            raise ValueError("Range out of bounds")

        end = min(end, file_size - 1)
        return start, end

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length header") from error

        body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON body") from error


def main():
    os.chdir(ROOT_DIR)
    server = ThreadingHTTPServer((HOST, PORT), ViewerHandler)
    print(f"Serving meeting viewer at http://{HOST}:{PORT}/meeting-viewer/")
    server.serve_forever()


if __name__ == "__main__":
    main()
