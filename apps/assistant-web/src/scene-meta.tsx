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
  assistantScenes['audio-import'],
  assistantScenes['company-research'],
  assistantScenes['visit-prepare'],
  assistantScenes.tasks,
];

export function getSceneByPath(pathname: string) {
  return sceneOrder.find((scene) => scene.route === pathname) ?? assistantScenes.chat;
}

export function buildPromptGroups(scene = assistantScenes.chat) {
  return {
    hotTopics: [
      {
        key: `${scene.key}-hot`,
        label: '热门话题',
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
        label: '场景指南',
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
