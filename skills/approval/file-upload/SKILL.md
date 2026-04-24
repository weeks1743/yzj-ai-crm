---
name: approval.file_upload
description: 通过云之家审批文件服务上传本地文件，并返回可直接写入轻云 attachmentWidget 的附件对象。
---

# Approval File Upload

Use this skill when a shadow write needs a real uploaded attachment, especially before calling customer/contact update skills that accept `attachmentWidget` values.

## Workflow

1. Read `references/execution.json` for the fixed internal API and upstream approval file-service chain.
2. Confirm the local file path exists. Do not guess or fabricate file metadata.
3. Call the internal upload API first: `POST /api/approval/files/upload`.
4. Reuse the returned `attachmentValue` object as-is in downstream LightCloud `attachmentWidget` fields.
5. Never invent `fileId`, `fileType`, `fileSize`, or `fileExt`.

## Input Rules

- Required params: `filePath`
- Optional params: `bizKey`
- Default `bizKey`: `cloudflow`
- Output must preserve both:
  - the raw uploaded file info
  - the normalized `attachmentValue` shape for LightCloud writes

## Output Contract

- Internal upload response includes:
  - `filePath`
  - `bizKey`
  - `accessTokenScope`
  - `uploaded`
  - `attachmentValue`
- `attachmentValue` must stay in LightCloud format:

```json
[
  {
    "fileName": "测试上传附件.pptx",
    "fileId": "69ea3d811285ac00016ede26",
    "fileSize": "3888931",
    "fileType": "doc",
    "fileExt": "pptx"
  }
]
```

## References

- `references/execution.json`
- `references/source-summary.md`
