import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { AppConfig } from './contracts.js';
import { ApprovalFileClient } from './approval-file-client.js';
import { BadRequestError, ConfigError } from './errors.js';

interface ApprovalFileServiceOptions {
  config: AppConfig;
  client: ApprovalFileClient;
}

export class ApprovalFileService {
  private readonly config: AppConfig;
  private readonly client: ApprovalFileClient;

  constructor(options: ApprovalFileServiceOptions) {
    this.config = options.config;
    this.client = options.client;
  }

  async uploadFile(params: {
    filePath: string;
    bizKey?: string;
  }): Promise<{
    filePath: string;
    bizKey: string;
    accessTokenScope: 'resGroupSecret';
    uploaded: {
      fileId: string;
      fileName: string;
      fileType: string;
      length: number;
      isEncrypted: boolean;
    };
    attachmentValue: {
      fileName: string;
      fileId: string;
      fileSize: string;
      fileType: string;
      fileExt: string;
    };
  }> {
    const fileSecret = this.config.yzj.approval.fileSecret;
    if (!fileSecret) {
      throw new ConfigError('缺少审批文件上传密钥: YZJ_APPROVAL_FILE_SECRET');
    }

    const absoluteFilePath = resolve(params.filePath);
    if (!existsSync(absoluteFilePath)) {
      throw new BadRequestError(`上传文件不存在: ${absoluteFilePath}`);
    }

    const accessToken = await this.client.getResourceAccessToken({
      eid: this.config.yzj.eid,
      secret: fileSecret,
    });
    const bizKey = params.bizKey?.trim() || 'cloudflow';
    const uploaded = await this.client.uploadFile({
      accessToken,
      filePath: absoluteFilePath,
      bizKey,
    });
    const fileExt =
      extname(uploaded.fileName).slice(1).toLowerCase() ||
      extname(absoluteFilePath).slice(1).toLowerCase();

    return {
      filePath: absoluteFilePath,
      bizKey,
      accessTokenScope: 'resGroupSecret',
      uploaded: {
        fileId: uploaded.fileId,
        fileName: uploaded.fileName,
        fileType: uploaded.fileType,
        length: uploaded.length,
        isEncrypted: Boolean(uploaded.isEncrypted),
      },
      attachmentValue: {
        fileName: uploaded.fileName,
        fileId: uploaded.fileId,
        fileSize: String(uploaded.length),
        fileType: uploaded.fileType,
        fileExt,
      },
    };
  }
}
