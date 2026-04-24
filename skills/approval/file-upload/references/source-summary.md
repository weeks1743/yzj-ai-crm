# Source Summary

This skill is based on `/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/yzj-api/智能审批.md` under `## 文件操作接口`.

## Official constraints

- File upload uses a dedicated access token and must not reuse team/business tokens.
- Token scope is `resGroupSecret`.
- Token secret comes from the approval file-service authorization settings, not the normal approval app secret.
- File upload endpoint is `POST https://www.yunzhijia.com/docrest/doc/file/uploadfile`.
- Request uses multipart form fields:
  - `file`
  - `bizkey`

## Repo normalization rule

The internal API returns a normalized `attachmentValue` object for LightCloud:

```json
{
  "fileName": "测试上传附件.pptx",
  "fileId": "69ea3d811285ac00016ede26",
  "fileSize": "3888931",
  "fileType": "doc",
  "fileExt": "pptx"
}
```

Use that object directly in `attachmentWidget` arrays. Do not strip `fileExt` or collapse the object to a bare `fileId`.
