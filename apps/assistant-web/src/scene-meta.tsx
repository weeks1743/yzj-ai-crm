import React from 'react';
import {
  assistantScenes,
  audioImportTasks,
  conversationSessions,
  researchSnapshots,
  sceneTasks,
  visitBriefs,
} from '@shared';

export const sceneOrder = [
  assistantScenes.chat,
  assistantScenes['post-visit-loop'],
  assistantScenes['customer-analysis'],
  assistantScenes['conversation-understanding'],
  assistantScenes['needs-todo-analysis'],
  assistantScenes['problem-statement'],
  assistantScenes['value-positioning'],
  assistantScenes['solution-expert-enablement'],
  assistantScenes.tasks,
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
        label: isHome ? '快速闭环入口' : '常见问题',
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

export const sceneContextData = {
  sessions: conversationSessions,
  tasks: sceneTasks,
  audioImportTasks,
  researchSnapshots,
  visitBriefs,
};
