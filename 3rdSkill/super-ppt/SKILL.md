---
name: super-ppt
description: Use this skill when a markdown report needs to be turned into an editable PPT through Docmee V2 API. This skill is deterministic and model-free: it expects exactly one `.md` attachment, generates a `.pptx`, stores markdown and metadata artifacts, and then opens the Docmee editor session for continued editing.
---

# super-ppt

## Purpose

Generate an enterprise presentation from a single markdown attachment by calling Docmee V2 API in deterministic code.

## Input Contract

- Exactly one attachment is required.
- The attachment must be a `.md` file.
- `requestText` is optional guidance for tone or target audience, but the main source of truth is the markdown attachment itself.

## Output Contract

- A final `.pptx` artifact
- A final markdown artifact used for generation
- A metadata `.json` artifact containing Docmee task and PPT identifiers
- A `presentation_ready` event with `pptId`, `subject`, and editor metadata

## Execution Notes

- This skill does not use LLM free-form orchestration.
- Runtime implementation lives in `apps/skill-runtime/src/skill-executor.ts`.
- Dependency: `env:DOCMEE_API_KEY`
