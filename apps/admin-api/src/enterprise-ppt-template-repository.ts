import { DatabaseSync } from 'node:sqlite';
import type { EnterprisePptTemplateItem } from './contracts.js';
import { NotFoundError } from './errors.js';

interface EnterprisePptTemplateRow {
  template_id: string;
  name: string;
  source_file_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface EnterprisePptTemplateSettingsRow {
  default_prompt: string;
}

function mapTemplate(row: EnterprisePptTemplateRow): EnterprisePptTemplateItem {
  return {
    templateId: row.template_id,
    name: row.name,
    sourceFileName: row.source_file_name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EnterprisePptTemplateRepository {
  constructor(private readonly database: DatabaseSync) {}

  getDefaultPrompt(): string | null {
    const row = this.database
      .prepare(
        `
          SELECT default_prompt
          FROM enterprise_ppt_template_settings
          WHERE singleton_id = 1
          LIMIT 1
        `,
      )
      .get() as EnterprisePptTemplateSettingsRow | undefined;

    return row?.default_prompt?.trim() || null;
  }

  updateDefaultPrompt(prompt: string): string {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO enterprise_ppt_template_settings (
            singleton_id,
            default_prompt,
            created_at,
            updated_at
          ) VALUES (1, ?, ?, ?)
          ON CONFLICT(singleton_id) DO UPDATE SET
            default_prompt = excluded.default_prompt,
            updated_at = excluded.updated_at
        `,
      )
      .run(prompt, now, now);

    return this.getDefaultPrompt() ?? prompt;
  }

  list(): EnterprisePptTemplateItem[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM enterprise_ppt_templates
          ORDER BY is_active DESC, updated_at DESC, template_id DESC
        `,
      )
      .all() as unknown as EnterprisePptTemplateRow[];

    return rows.map(mapTemplate);
  }

  getById(templateId: string): EnterprisePptTemplateItem | null {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM enterprise_ppt_templates
          WHERE template_id = ?
          LIMIT 1
        `,
      )
      .get(templateId) as EnterprisePptTemplateRow | undefined;

    return row ? mapTemplate(row) : null;
  }

  getActive(): EnterprisePptTemplateItem | null {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM enterprise_ppt_templates
          WHERE is_active = 1
          LIMIT 1
        `,
      )
      .get() as EnterprisePptTemplateRow | undefined;

    return row ? mapTemplate(row) : null;
  }

  save(input: {
    templateId: string;
    name: string;
    sourceFileName: string;
  }): EnterprisePptTemplateItem {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO enterprise_ppt_templates (
            template_id,
            name,
            source_file_name,
            is_active,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 0, ?, ?)
          ON CONFLICT(template_id) DO UPDATE SET
            name = excluded.name,
            source_file_name = excluded.source_file_name,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.templateId,
        input.name,
        input.sourceFileName,
        now,
        now,
      );

    return this.requireById(input.templateId);
  }

  rename(templateId: string, name: string): EnterprisePptTemplateItem {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `
          UPDATE enterprise_ppt_templates
          SET name = ?,
              updated_at = ?
          WHERE template_id = ?
        `,
      )
      .run(name, now, templateId);

    if (result.changes === 0) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    return this.requireById(templateId);
  }

  activate(templateId: string): EnterprisePptTemplateItem {
    if (!this.getById(templateId)) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `
            UPDATE enterprise_ppt_templates
            SET is_active = 0,
                updated_at = ?
            WHERE is_active = 1
          `,
        )
        .run(now);

      this.database
        .prepare(
          `
            UPDATE enterprise_ppt_templates
            SET is_active = 1,
                updated_at = ?
            WHERE template_id = ?
          `,
        )
        .run(now, templateId);

      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return this.requireById(templateId);
  }

  delete(templateId: string): void {
    this.database
      .prepare(
        `
          DELETE FROM enterprise_ppt_templates
          WHERE template_id = ?
        `,
      )
      .run(templateId);
  }

  private requireById(templateId: string): EnterprisePptTemplateItem {
    const item = this.getById(templateId);
    if (!item) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    return item;
  }
}
