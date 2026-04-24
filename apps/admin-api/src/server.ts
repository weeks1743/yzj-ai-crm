import { dirname, resolve } from 'node:path';
import { ApprovalFileClient } from './approval-file-client.js';
import { ApprovalFileService } from './approval-file-service.js';
import { ApprovalClient } from './approval-client.js';
import { createAdminApiServer } from './app.js';
import { loadAppConfig } from './config.js';
import { openDatabase } from './database.js';
import { DictionaryResolver } from './dictionary-resolver.js';
import { ExternalSkillService } from './external-skill-service.js';
import { LightCloudClient } from './lightcloud-client.js';
import { OrgSyncRepository } from './org-sync-repository.js';
import { OrgSyncService } from './org-sync-service.js';
import { ShadowMetadataRepository } from './shadow-metadata-repository.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';
import { YzjClient } from './yzj-client.js';

const config = loadAppConfig();
const database = openDatabase(config.storage.sqlitePath);

const orgSyncRepository = new OrgSyncRepository(database);
orgSyncRepository.markRunningRunsAsFailed('admin-api 重启前有同步未完成，已自动标记为失败');

const orgSyncService = new OrgSyncService({
  config,
  repository: orgSyncRepository,
  client: new YzjClient({
    baseUrl: config.yzj.baseUrl,
  }),
});

const approvalClient = new ApprovalClient({
  baseUrl: config.yzj.baseUrl,
});
const approvalFileService = new ApprovalFileService({
  config,
  client: new ApprovalFileClient({
    baseUrl: config.yzj.baseUrl,
  }),
});
const shadowMetadataService = new ShadowMetadataService({
  config,
  repository: new ShadowMetadataRepository(database),
  approvalClient,
  lightCloudClient: new LightCloudClient({
    baseUrl: config.yzj.baseUrl,
  }),
  dictionaryResolver: new DictionaryResolver({
    source: config.shadow.dictionarySource,
    jsonPath: config.shadow.dictionaryJsonPath,
    approvalClient,
    fieldBoundWorkbookPath: resolve(
      dirname(config.meta.envFilePath),
      'yzj-api/省市区数据信息.xlsx',
    ),
  }),
});
const externalSkillService = new ExternalSkillService({
  config,
});

const server = createAdminApiServer({
  config,
  orgSyncService,
  approvalFileService,
  shadowMetadataService,
  externalSkillService,
});

server.listen(config.server.port, () => {
  console.log(
    `[admin-api] listening on http://127.0.0.1:${config.server.port} (sqlite: ${config.storage.sqlitePath})`,
  );
});
