import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { JobArtifact } from './contracts.js';
import { BadRequestError } from './errors.js';
import { JobRepository } from './job-repository.js';

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function guessMimeType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  switch (extension) {
    case '.md':
      return 'text/markdown';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export class ArtifactStore {
  constructor(
    private readonly artifactDir: string,
    private readonly repository: JobRepository,
  ) {
    mkdirSync(this.artifactDir, { recursive: true });
  }

  writeTextArtifact(
    jobId: string,
    fileName: string,
    content: string,
    mimeType = 'text/markdown',
  ): JobArtifact {
    const safeName = sanitizeFileName(fileName);
    const jobArtifactDir = join(this.artifactDir, jobId);
    mkdirSync(jobArtifactDir, { recursive: true });
    const artifactPath = join(jobArtifactDir, safeName);
    writeFileSync(artifactPath, content, 'utf8');
    const byteSize = Buffer.byteLength(content, 'utf8');
    return this.repository.addArtifact({
      jobId,
      fileName: safeName,
      mimeType,
      filePath: artifactPath,
      byteSize,
    });
  }

  publishFile(
    jobId: string,
    sourcePath: string,
    fileName?: string,
    mimeType?: string,
  ): JobArtifact {
    const stat = statSync(sourcePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw new BadRequestError(`Artifact 源文件不存在: ${sourcePath}`);
    }

    const finalFileName = sanitizeFileName(fileName || sourcePath.split('/').pop() || 'artifact');
    const jobArtifactDir = join(this.artifactDir, jobId);
    mkdirSync(jobArtifactDir, { recursive: true });
    const destinationPath = join(jobArtifactDir, finalFileName);
    copyFileSync(sourcePath, destinationPath);

    return this.repository.addArtifact({
      jobId,
      fileName: finalFileName,
      mimeType: mimeType || guessMimeType(finalFileName),
      filePath: destinationPath,
      byteSize: stat.size,
    });
  }

  readArtifact(jobId: string, artifactId: string): {
    artifact: JobArtifact;
    content: Buffer;
  } {
    const { filePath, ...artifact } = this.repository.getArtifact(jobId, artifactId);
    return {
      artifact,
      content: readFileSync(filePath),
    };
  }
}
