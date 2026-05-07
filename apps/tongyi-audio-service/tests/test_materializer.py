from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tongyi_audio_service.materializer import PROCESS_ONLY_FILES, materialize_recording


class MaterializerTest(unittest.TestCase):
    def test_generated_markdown_excludes_process_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "fixture-001"
            assets_dir = task_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "summarization.json").write_text(
                json.dumps(
                    {
                        "conversationalSummary": [
                            {"speakerName": "发言人1", "summary": "客户关注预算与试点周期。"},
                        ],
                        "mindMapSummary": [{"title": "试点推进", "topic": [{"title": "预算确认"}]}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (assets_dir / "meetingAssistance.json").write_text(
                json.dumps({"keywords": ["预算", "试点", "审批"]}, ensure_ascii=False),
                encoding="utf-8",
            )
            (assets_dir / "autoChapters.json").write_text(
                json.dumps(
                    [{"start": 0, "end": 61000, "headline": "确认试点范围", "summary": "双方讨论试点范围。"}],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            material = materialize_recording(
                "fixture-001",
                task_dir,
                preferred_source="generated",
                anchors={"customer": "星海精工", "opportunity": "MES 试点"},
                source_file_name="visit.m4a",
            )

        self.assertEqual(material.source, "generated")
        self.assertIn("客户关注预算与试点周期", material.markdown)
        self.assertIn("确认试点范围", material.markdown)
        self.assertIn("星海精工", material.markdown)
        self.assertIn("新增拜访记录", material.markdown)
        self.assertNotIn("生成跟进记录草稿", material.markdown)
        for file_name in PROCESS_ONLY_FILES:
            self.assertNotIn(file_name, material.markdown)

    def test_auto_prefers_standard_material_and_appends_profile_when_assets_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "fixture-rich"
            assets_dir = task_dir / "assets"
            profile_dir = task_dir / "profile-analysis"
            assets_dir.mkdir(parents=True)
            profile_dir.mkdir(parents=True)
            (assets_dir / "summarization.json").write_text(
                json.dumps(
                    {
                        "conversationalSummary": [
                            {"speakerName": "客户", "summary": "客户正在评估协同办公平台替换路径。"},
                        ],
                        "mindMapSummary": [{"title": "协同办公替换"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (profile_dir / "crm_visit-20260410-165921.md").write_text(
                "# CRM 客户拜访结构化画像\n\n## 客户侧\n- 核心关注点：央企项目交付和低代码沉淀。",
                encoding="utf-8",
            )

            material = materialize_recording("fixture-rich", task_dir, preferred_source="auto")

        self.assertEqual(material.source, "generated")
        self.assertIn("客户正在评估协同办公平台替换路径", material.markdown)
        self.assertIn("客户录音分析", material.markdown)
        self.assertIn("央企项目交付和低代码沉淀", material.markdown)

    def test_generated_markdown_uses_standalone_mindmap_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "fixture-mindmap"
            assets_dir = task_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "mindMapSummary.json").write_text(
                json.dumps(
                    {
                        "mindMapSummary": [
                            {
                                "title": "会议讨论概览",
                                "topic": [
                                    {"title": "部署节奏"},
                                    {"title": "客户成功关注点"},
                                ],
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            material = materialize_recording("fixture-mindmap", task_dir, preferred_source="generated")

        self.assertEqual(material.source, "generated")
        self.assertIn("会议讨论概览", material.markdown)
        self.assertIn("部署节奏", material.markdown)
        self.assertIn("暂无可用会话摘要", material.markdown)

    def test_generated_markdown_does_not_derive_analysis_from_transcription(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "fixture-transcription-only"
            assets_dir = task_dir / "assets"
            assets_dir.mkdir(parents=True)
            (assets_dir / "transcription.json").write_text(
                json.dumps(
                    {
                        "audioInfo": {"duration": 62000},
                        "paragraphs": [
                            {
                                "speakerId": "1",
                                "words": [
                                    {"start": 0, "end": 500, "text": "客户"},
                                    {"start": 500, "end": 1000, "text": "需要"},
                                    {"start": 1000, "end": 1600, "text": "审批权限"},
                                ],
                            },
                            {
                                "speakerId": "2",
                                "words": [
                                    {"start": 30000, "end": 30500, "text": "我方"},
                                    {"start": 30500, "end": 31200, "text": "确认"},
                                    {"start": 31200, "end": 32000, "text": "账号配置"},
                                ],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            material = materialize_recording("fixture-transcription-only", task_dir, preferred_source="generated")

        self.assertEqual(material.source, "generated")
        self.assertIn("暂无可用会话摘要", material.markdown)
        self.assertIn("暂无可用主题", material.markdown)
        self.assertNotIn("审批权限", material.markdown)
        self.assertNotIn("## 转写摘录", material.markdown)

    def test_profile_markdown_can_be_used_as_material(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "fixture-002"
            profile_dir = task_dir / "profile-analysis"
            profile_dir.mkdir(parents=True)
            (profile_dir / "crm_visit-20260410-165921.md").write_text(
                "# CRM 客户拜访结构化画像\n\n## 客户侧\n- 核心关注点：审批和预算。",
                encoding="utf-8",
            )

            material = materialize_recording("fixture-002", task_dir, preferred_source="auto")

        self.assertEqual(material.source, "profile_analysis")
        self.assertIn("客户录音分析", material.markdown)
        self.assertIn("审批和预算", material.markdown)
        for file_name in PROCESS_ONLY_FILES:
            self.assertNotIn(file_name, material.markdown)


if __name__ == "__main__":
    unittest.main()
