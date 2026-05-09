import React from 'react';
import type { AssistantScene } from '@shared/types';

export const assistantScenes: Record<'chat', AssistantScene> = {
  chat: {
    key: 'chat',
    route: '/chat',
    title: 'AI 销售工作台',
    subtitle: '公司研究与拜访准备工作台',
    headline: '输入客户名称，生成研究资料或准备客户拜访。',
    description: '已有有效公司研究会直接复用；拜访准备会先解析客户对象，再读取该客户关联的公司研究 Markdown。',
    defaultInput: '输入客户名称，客户关注点可选',
    prompts: [
      { key: 'p1', label: '/公司研究', description: '激活公司研究技能后输入公司全称。' },
      { key: 'p2', label: '/公司研究 上海松井机械有限公司', description: '明确测试示例：上海松井机械有限公司。' },
      { key: 'p3', label: '/拜访准备', description: '选择客户并基于关联公司研究生成拜访材料。' },
    ],
    hotTopics: [
      { key: 'h1', title: '/公司研究', description: '激活公司研究技能，手动输入公司全称。' },
      { key: 'h2', title: '/公司研究 上海松井机械有限公司', description: '明确测试示例：上海松井机械有限公司。' },
      { key: 'h3', title: '/拜访准备 贝斯美', description: '按客户对象调用客户拜访准备助手。' },
      { key: 'h4', title: '这个客户最近有什么值得关注', description: '基于当前已有研究继续追问。' },
    ],
    guides: [
      { key: 'g1', title: '已有研究默认复用', description: '已有有效公司研究时直接引用，不重复调用外部技能。' },
      { key: 'g2', title: '拜访准备依赖客户资料', description: '缺少客户对象或有效公司研究 Markdown 时不会编造客户背景，会提示补充或先执行公司研究。' },
      { key: 'g3', title: '失败不生成资料', description: '外部技能失败或没有 Markdown 时，只保留运行记录。' },
      { key: 'g4', title: '结果可继续追问', description: '研究或拜访准备完成后可围绕业务定位、成长驱动、讲解提纲继续提问。' },
    ],
    taskCards: [],
  },
};

export const sceneOrder = [
  assistantScenes.chat,
];

export function getSceneByPath(pathname: string) {
  return sceneOrder.find((scene) => scene.route === pathname) ?? assistantScenes.chat;
}

export function buildPromptGroups(scene = assistantScenes.chat) {
  const isHome = scene.key === 'chat';
  return {
    hotTopics: [
      {
        key: `${scene.key}-hot`,
        label: isHome ? '能力入口' : '使用说明',
        children: scene.hotTopics.map((item, index) => ({
          key: item.key,
          description: item.title,
          icon: (
            <span
              style={{
                color: index < 3 ? '#1677ff' : '#94a3b8',
                fontWeight: 700,
              }}
            >
              {index + 1}
            </span>
          ),
        })),
      },
    ],
    guides: [
      {
        key: `${scene.key}-guide`,
        label: isHome ? '工作台原则' : '场景指南',
        children: scene.guides.map((item) => ({
          key: item.key,
          label: item.title,
          description: item.description,
        })),
      },
    ],
  };
}
