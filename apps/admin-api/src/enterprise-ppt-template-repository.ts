import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type { EnterprisePptTemplateItem } from './contracts.js';
import { NotFoundError } from './errors.js';

interface EnterprisePptTemplateRow extends QueryResultRow {
  template_id: string;
  name: string;
  source_file_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EnterprisePptTemplateSettingsRow extends QueryResultRow {
  default_prompt: string;
}

function mapTemplate(row: EnterprisePptTemplateRow): EnterprisePptTemplateItem {
  return {
    templateId: row.template_id,
    name: row.name,
    sourceFileName: row.source_file_name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EnterprisePptTemplateRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async getDefaultPrompt(): Promise<string | null> {
    const row = await this.database.queryMaybeOne<EnterprisePptTemplateSettingsRow>(
      `
        SELECT default_prompt
        FROM ${this.database.table('enterprise_ppt_template_settings')}
        WHERE singleton_id = 1
      `,
    );

    return row?.default_prompt?.trim() || null;
  }

  async updateDefaultPrompt(prompt: string): Promise<string> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('enterprise_ppt_template_settings')} (
          singleton_id,
          default_prompt,
          created_at,
          updated_at
        ) VALUES (1, $1, $2, $3)
        ON CONFLICT (singleton_id) DO UPDATE SET
          default_prompt = EXCLUDED.default_prompt,
          updated_at = EXCLUDED.updated_at
      `,
      [prompt, now, now],
    );

    return (await this.getDefaultPrompt()) ?? prompt;
  }

  async list(): Promise<EnterprisePptTemplateItem[]> {
    const rows = await this.database.query<EnterprisePptTemplateRow>(
      `
        SELECT *
        FROM ${this.database.table('enterprise_ppt_templates')}
        ORDER BY is_active DESC, updated_at DESC, template_id DESC
      `,
    );

    return rows.map(mapTemplate);
  }

  async getById(templateId: string): Promise<EnterprisePptTemplateItem | null> {
    const row = await this.database.queryMaybeOne<EnterprisePptTemplateRow>(
      `
        SELECT *
        FROM ${this.database.table('enterprise_ppt_templates')}
        WHERE template_id = $1
      `,
      [templateId],
    );

    return row ? mapTemplate(row) : null;
  }

  async getActive(): Promise<EnterprisePptTemplateItem | null> {
    const row = await this.database.queryMaybeOne<EnterprisePptTemplateRow>(
      `
        SELECT *
        FROM ${this.database.table('enterprise_ppt_templates')}
        WHERE is_active = true
        LIMIT 1
      `,
    );

    return row ? mapTemplate(row) : null;
  }

  async save(input: {
    templateId: string;
    name: string;
    sourceFileName: string;
  }): Promise<EnterprisePptTemplateItem> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('enterprise_ppt_templates')} (
          template_id,
          name,
          source_file_name,
          is_active,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, false, $4, $5)
        ON CONFLICT (template_id) DO UPDATE SET
          name = EXCLUDED.name,
          source_file_name = EXCLUDED.source_file_name,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.templateId,
        input.name,
        input.sourceFileName,
        now,
        now,
      ],
    );

    return this.requireById(input.templateId);
  }

  async rename(templateId: string, name: string): Promise<EnterprisePptTemplateItem> {
    const now = new Date().toISOString();
    const rows = await this.database.query<EnterprisePptTemplateRow>(
      `
        UPDATE ${this.database.table('enterprise_ppt_templates')}
        SET name = $1,
            updated_at = $2
        WHERE template_id = $3
        RETURNING *
      `,
      [name, now, templateId],
    );

    if (rows.length === 0) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    return mapTemplate(rows[0]!);
  }

  async activate(templateId: string): Promise<EnterprisePptTemplateItem> {
    const current = await this.getById(templateId);
    if (!current) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    const now = new Date().toISOString();
    await this.database.transaction(async (tx) => {
      await tx.query(
        `
          UPDATE ${tx.table('enterprise_ppt_templates')}
          SET is_active = false,
              updated_at = $1
          WHERE is_active = true
        `,
        [now],
      );

      await tx.query(
        `
          UPDATE ${tx.table('enterprise_ppt_templates')}
          SET is_active = true,
              updated_at = $1
          WHERE template_id = $2
        `,
        [now, templateId],
      );
    });

    return this.requireById(templateId);
  }

  async delete(templateId: string): Promise<void> {
    await this.database.query(
      `
        DELETE FROM ${this.database.table('enterprise_ppt_templates')}
        WHERE template_id = $1
      `,
      [templateId],
    );
  }

  private async requireById(templateId: string): Promise<EnterprisePptTemplateItem> {
    const item = await this.getById(templateId);
    if (!item) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    return item;
  }
}
