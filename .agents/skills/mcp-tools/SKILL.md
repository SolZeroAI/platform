---
name: mcp-tools
description: Use when adding, changing, or reviewing MCP servers, MCP tools, session tools, tool registration, Cloudflare AI Search sources, AI Search ingestion resources, or the AI Search MCP server in this repo.
---
# MCP Tools

Use this skill when working on MCP/tool behavior in this repo. Start from the shared contracts and existing registration points, then wire the runtime. Avoid adding one-off tool code when an existing tool surface or registry can express the behavior.

## General MCP And Tool Pattern

- Shared session tool contracts live in `packages/shared/src/session-tools.ts`.
- Session MCP selection, headers, and internal server config live in `packages/api/src/server/background/session/mcp-config.ts`.
- Internal MCP server entrypoints live under `packages/api/src/server/mcp/`.
- Isolate/local session tools live under `packages/api/src/server/background/isolate/`.
- Effect API schemas and routes live under `packages/api/src/http/` and `packages/api/src/server/effect/`.

When adding or changing a tool:

1. Put user/session-visible identifiers in the shared package first.
2. Normalize and validate user-selected tools at the boundary where tools enter session state.
3. Register MCP tools with stable, action-oriented names and descriptions that state what the tool returns.
4. Keep authorization and selection outside the runtime. The MCP server should only register tools attached to the current session.
5. Dispatch from the tool registration into a shared runtime function. Do not fork source-specific logic into separate MCP servers unless the protocol or auth model is actually different.
6. Preserve isolate behavior. Docs-only sessions must not require an attached repository.
7. Update tests at the contract, MCP config, runtime, and Worker route levels when the public tool surface changes.

## Internal MCP Rules

- Use one MCP server when tools share auth, transport, and runtime dependencies.
- Expose each selected capability as its own MCP tool in `tools/list`.
- Keep custom MCP servers separate from predefined internal tools. Reject custom names that collide with reserved internal server names.
- Keep follow-up streamable HTTP requests working by preserving header-based source selection and the D1 session fallback via `x-c0-session-id`.
- Keep tool input schemas narrow. Prefer `query: z.string().min(1)` for search tools unless the caller genuinely needs more control.

## AI Search Source Pattern

AI Search resources in this repo use a common shape:

```text
docs in R2 -> Cloudflare AI Search vector index -> shared MCP runtime -> source-specific MCP tools
```

For a new AI Search-backed document source:

1. Create or adopt the R2 content bucket and AI Search namespaces in `createAgentResources` in `apps/api/infra/resources.ts`.
2. Bind `AI_SEARCH`, `WORKFLOW_AI_SEARCH`, and `AI_SEARCH_CONTENT_BUCKET` in `apps/api/infra/index.ts`.
3. Add public source metadata in `packages/shared/src/session-tools.ts`.
4. Add runtime config in `packages/api/src/server/mcp/ai-search-sources.ts`, keeping `maxResults` explicit and source IDs resolved through the shared map.
5. Register the source in `packages/api/src/server/mcp/ai-search-server.ts`.
6. Run the MCP integration tests and update any session UI source picker affected by the new source.

Each AI Search source should expose two MCP tools:

- `search_*`: calls the shared runtime with `mode: "search"` and returns retrieval-only source results.
- `ask_*`: calls the shared runtime with `mode: "aiSearch"` and returns a generated answer plus retrieved sources.

The runtime belongs in `packages/api/src/server/mcp/ai-search-runtime.ts`. It should accept the source id, query, runtime context, and required mode, then call the configured AI Search binding. Do not add default-mode or old-env fallbacks; source differences should come from registry metadata and runtime config.

## Runtime-Configured AI Search Sources

AI Search sources are created and maintained through the runtime registry. Do
not hardcode source ids, labels, domains, or document collections in this
skill; each deployment chooses its own sources.

## Validation

Run focused checks while iterating:

```bash
nub exec vitest run tests/integration/ai-search-mcp.test.ts tests/integration/session-mcp-config.test.ts
```

Before handoff, run the repo-root checks required by `AGENTS.md`:

```bash
nub run typecheck
nub run lint
nub run format
```
