# AGENTS.md

The prompt files in this directory were copied from:

- https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/session/prompt

They were modified to conform to the runtime capabilities of Cloudflare Workers and the structured workspace and git capabilities available via `@cloudflare/shell`.

These prompt files must not claim OpenCode-specific tools or capabilities. Keep them aligned with the isolate runtime and the tools exposed in `packages/api/src/server/background/isolate/tools.ts`.
