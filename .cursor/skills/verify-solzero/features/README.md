# User flow map

This directory is the **coverage map source of truth** for SolZero e2e user flows.
`docs/e2e.md` points here for the inventory; keep fixture preflight, replay, cleanup,
and CI guidance in that guide. Automated recipes live under `tests/` and run only through
tester-army/e2e.

| Area | Feature file | Canonical suite(s) |
| --- | --- | --- |
| Auth, anonymous gates, sign-in/out | `auth.md` | `tests/auth.e2e.ts` (+ `tests/auth.setup.e2e.ts`) |
| Settings, runtime defaults, theme, MCP deep links, secrets | `settings.md` | `tests/settings.e2e.ts` |
| Accounts, API keys, OpenAPI contracts | `accounts.md` | `tests/accounts.e2e.ts`, `tests/api-contract.e2e.ts` |
| Skills (admin defaults and user overrides) | `skills.md` | `tests/skills.e2e.ts` |
| Sessions / Agents home (create, tools, archive, isolate/OpenCode/Codex prompts) | `sessions.md` | `tests/sessions.e2e.ts` |
| Advanced sessions (incognito, MCP/subagent editor, attachment cancel, delegation) | `advanced-sessions.md` | `tests/advanced-sessions.e2e.ts` |
| Harness tools (OpenCode/Codex multi-tool and follow-up) | `harness-tools.md` | `tests/harness-tools.e2e.ts` |
| Session transfer (auth-transfer redemption) | `session-transfer.md` | `tests/session-transfer.e2e.ts` |
| External integrations (GitHub, MCP, AI Search, Slack) | `external-integrations.md` | `tests/external-integrations.e2e.ts` |
| BYOK / personal provider | `providers.md` | `tests/provider.external.e2e.ts` |
| OIDC identity (ordinary member) | `identity.md` | `tests/identity.external.e2e.ts` |
| Workflows | `workflows.md` | `tests/workflows.e2e.ts` |
| Bots | `bots.md` | `tests/bots.e2e.ts` |
| Admin control plane | `admin.md` | `tests/admin.e2e.ts` |

Prefer `nub run test:e2e -- tests/<file>.e2e.ts` so the project wrapper owns cleanup.
`nub run test` runs the core catalogue (excludes `external`). `nub run test:e2e:external`
and `nub run test:e2e:all` cover deferred integrations. Read `.agents/skills/e2e/SKILL.md`
for authoring and `docs/e2e.md` for credentials, fixtures, and ops.

### Ops (not product features)

Lifecycle and owned-resource cleanup live under `tests/lifecycle/` and run with
`nub run test:e2e:lifecycle`. They prove launcher recovery, not product UI coverage.
See `docs/e2e.md` for cleanup and CI artifact rules.

Do not count a blocked or deferred-external flow as passing coverage. Collection alone
does not establish verification.
