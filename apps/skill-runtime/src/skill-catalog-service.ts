import type {
  DependencySnapshot,
  LoadedSkill,
  SkillCatalogEntry,
  SkillStatus,
} from './contracts.js';
import { getDependencyDetail } from './dependency-probe.js';

const EXECUTABLE_SKILLS = new Set([
  'company-research',
  'visit-conversation-understanding',
  'customer-needs-todo-analysis',
  'problem-statement',
  'customer-value-positioning',
  'super-ppt',
]);

const SKILL_DEPENDENCIES: Record<string, string[]> = {
  'company-research': [
    'env:DEEPSEEK_API_KEY',
    'env:ARK_API_KEY',
  ],
  'visit-conversation-understanding': [
    'env:DEEPSEEK_API_KEY',
  ],
  'customer-needs-todo-analysis': [
    'env:DEEPSEEK_API_KEY',
  ],
  'problem-statement': [
    'env:DEEPSEEK_API_KEY',
  ],
  'customer-value-positioning': [
    'env:DEEPSEEK_API_KEY',
  ],
  'super-ppt': [
    'env:DOCMEE_API_KEY',
  ],
};

function resolveAllowedTools(skill: LoadedSkill): string[] {
  if (skill.profile.allowedTools.length > 0) {
    return skill.profile.allowedTools;
  }

  if (skill.skillName === 'company-research') {
    return ['web_search', 'web_fetch_extract', 'read_skill_file', 'write_text_artifact'];
  }

  if (
    skill.skillName === 'visit-conversation-understanding'
    || skill.skillName === 'customer-needs-todo-analysis'
    || skill.skillName === 'problem-statement'
    || skill.skillName === 'customer-value-positioning'
  ) {
    return ['read_skill_file', 'read_source_file', 'write_text_artifact'];
  }

  if (skill.skillName === 'super-ppt') {
    return [];
  }

  return [];
}

function resolveStatus(
  skillName: string,
  dependencySnapshot: DependencySnapshot,
): {
  status: SkillStatus;
  requiredDependencies: string[];
  missingDependencies: string[];
  supportsInvoke: boolean;
} {
  const requiredDependencies = SKILL_DEPENDENCIES[skillName] ?? [];
  const missingDependencies = requiredDependencies.filter((dependency) => {
    const detail = getDependencyDetail(dependencySnapshot, dependency);
    return detail ? !detail.available : true;
  });

  if (EXECUTABLE_SKILLS.has(skillName)) {
    const status: SkillStatus = missingDependencies.length > 0 ? 'blocked' : 'available';
    return {
      status,
      requiredDependencies,
      missingDependencies,
      supportsInvoke: status === 'available',
    };
  }

  if (!EXECUTABLE_SKILLS.has(skillName)) {
    return {
      status: 'unsupported_yet',
      requiredDependencies,
      missingDependencies,
      supportsInvoke: false,
    };
  }

  return {
    status: 'unsupported_yet',
    requiredDependencies,
    missingDependencies,
    supportsInvoke: false,
  };
}

export class SkillCatalogService {
  constructor(
    private readonly loadedSkills: LoadedSkill[],
    private readonly dependencySnapshot: DependencySnapshot,
  ) {}

  listSkills(): SkillCatalogEntry[] {
    return this.loadedSkills.map((skill) => {
      const statusInfo = resolveStatus(skill.skillName, this.dependencySnapshot);
      const allowedTools = resolveAllowedTools(skill);
      return {
        skillName: skill.skillName,
        status: statusInfo.status,
        profile: {
          ...skill.profile,
          allowedTools,
        },
        supportsInvoke: statusInfo.supportsInvoke,
        requiredDependencies: statusInfo.requiredDependencies,
        missingDependencies: statusInfo.missingDependencies,
        summary: skill.profile.description,
      };
    });
  }

  getSkill(skillName: string): LoadedSkill | undefined {
    return this.loadedSkills.find((skill) => skill.skillName === skillName);
  }

  getCatalogEntry(skillName: string): SkillCatalogEntry | undefined {
    return this.listSkills().find((skill) => skill.skillName === skillName);
  }

  getDependencySnapshot(): DependencySnapshot {
    return this.dependencySnapshot;
  }
}
