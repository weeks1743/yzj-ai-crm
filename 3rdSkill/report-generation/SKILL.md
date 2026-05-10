---
name: report-generation
description: Generate an interactive visual report from one markdown attachment by calling the built-in report canvas service.
---

# report-generation

## Purpose

Turn a markdown business research document into an interactive report page through the built-in `apps/report-canvas-service`.

## Input Contract

- Exactly one attachment is required.
- The attachment must be a `.md` file.
- The attachment markdown is the source of truth.
- `requestText` may contain audience, style, or analysis instructions.

## Output Contract

- A JSON metadata artifact containing the report session id, public open URL, status, and generation metadata.
- A generated React report source artifact for audit/debug.
- A `report_ready` job event with `sessionId` and `openUrl`.

## Execution Notes

- This skill does not use free-form tool orchestration.
- Runtime implementation lives in `apps/skill-runtime/src/skill-executor.ts`.
- It calls `REPORT_CANVAS_SERVICE_BASE_URL` server-to-server and exposes `REPORT_CANVAS_PUBLIC_BASE_URL` for users to open the report in a new page.
- Dependency: `env:DASHSCOPE_API_KEY` for the report canvas service.
