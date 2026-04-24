import type {
  DependencySnapshot,
  LoadedSkill,
  SkillCatalogEntry,
  SkillStatus,
} from './contracts.js';
import { getDependencyDetail } from './dependency-probe.js';

const EXECUTABLE_SKILLS = new Set(['company-research', 'pptx']);
const EXPLICIT_UNSUPPORTED_SKILLS = new Set(['docx', 'xlsx', 'pdf']);

const SKILL_DEPENDENCIES: Record<string, string[]> = {
  'company-research': [
    'env:DEEPSEEK_API_KEY',
    'env:ARK_API_KEY',
  ],
  pptx: [
    'env:DEEPSEEK_API_KEY',
    'command:python3',
    'command:markitdown',
    'command:soffice',
    'command:pdftoppm',
    'python_module:markitdown',
    'python_module:PIL',
    'python_module:pptx',
    'python_module:defusedxml',
  ],
  docx: [
    'command:python3',
    'command:soffice',
    'command:pdftoppm',
  ],
  xlsx: [
    'command:python3',
    'command:soffice',
    'python_module:openpyxl',
  ],
  pdf: [
    'command:python3',
  ],
};

function resolveAllowedTools(skill: LoadedSkill): string[] {
  if (skill.profile.allowedTools.length > 0) {
    return skill.profile.allowedTools;
  }

  if (skill.skillName === 'company-research') {
    return ['web_search', 'web_fetch_extract', 'read_skill_file', 'write_text_artifact'];
  }

  if (skill.skillName === 'pptx') {
    return [
      'read_source_file',
      'pptx_plan_deck',
      'pptx_render_deck',
      'pptx_quality_check',
      'pptx_render_previews',
      'pptx_extract_text',
      'pptx_thumbnail',
      'office_unpack',
      'office_pack',
      'pptx_clean',
      'pptx_add_slide',
      'office_convert_pdf',
      'pdf_to_image',
      'read_workspace_file',
      'write_workspace_file',
      'read_skill_file',
    ];
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

  if (EXPLICIT_UNSUPPORTED_SKILLS.has(skillName) || !EXECUTABLE_SKILLS.has(skillName)) {
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
