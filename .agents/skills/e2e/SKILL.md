---
name: e2e
description: Agentic end-to-end tests with e2e, the e2e runner. Covers scaffolding e2e.config.ts, picking the Playwright browser engine or the agent-device mobile engine, starting the app under test from the config, driving flows with agent.act, judging with agent.assert, agent.waitFor, and agent.extract, pinning values with screen, app, browser, and expect, shaping the agent (context, system prompt, tools, personas), the replay cache, the e2e CLI, reading .e2e/report.json, and bug bashes (parallel explore runs proven with repro tests). Use when a project depends on e2e, when asked for end-to-end, browser, mobile, or agentic UI tests, to bug bash or hunt for bugs, or when an e2e run fails.
---

## SolZero contract

Use `e2e.config.ts` and the real Alchemy deployment, with configured disposable administrator accounts from `config/e2e-dev.config.jsonc`. All test code lives in `tests/**/*.e2e.ts`. Use the Cloudflare Clef executor in `scripts/e2e/cf-clef-executor.ts`, not the generic model examples below. Clef makes semantic decisions and assertions from the observed tree and redacted screenshots; exact text values go in `agent.act` params, while credential and secret inputs use e2e handles with `screen.fill`. Use exact `expect` polling rather than the unsupported Clef `waitFor` and `extract` methods. See `docs/e2e.md` for the coverage inventory and prerequisites.

Do not send feedback, app content, test artifacts, or messages to external recipients unless the user explicitly authorizes it. Record tooling defects in the repository testing documentation.


# e2e: agentic end-to-end tests in TypeScript

This repository uses Nub and Cloudflare Clef through AI Gateway. Its decision executor supports `agent.act` and visual `agent.assert`; use deterministic `expect` assertions for waiting and exact values. The bundled upstream topics also describe `waitFor` and `extract`, which this executor does not implement.

e2e runs UI tests with agent goals and exact assertions. `agent.act` drives
one goal; `agent.assert`, `agent.waitFor`, and `agent.extract` judge the
screen. `screen`, `app`, `browser`, and `expect` make exact interactions and
checks. The replay cache reruns verified actions and checks their recorded end
state without a model call; agent judgments still run live. UI targets use
`@e2e-dev/web` for browsers or `@e2e-dev/mobile` for iOS simulators,
Android emulators, and connected phones. A test that takes only `app` can check an API with `fetch`
and `expect` (topic `writing-tests`). Model sign-in commands are in
[setup](references/setup.md#subscriptions-and-api-keys).

```ts
// e2e.config.ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createClefExecutor } from './scripts/e2e/cf-clef-executor';

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: 'http://127.0.0.1:3000',
        command: { executable: 'nub', args: ['dev'], log: '.e2e/logs/app.log' },
      },
    },
  ],
  // Use the repository's vision-capable Cloudflare Clef executor through AI Gateway.
  agents: {
    default: {
      executor: createClefExecutor(),
      system: 'You are a thorough QA agent. Verify every outcome on screen.',
    },
  },
} satisfies E2EConfig;
```

```ts
// tests/billing.e2e.ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('a member upgrades to Pro', async ({ app, agent, screen, browser }) => {
  await app.open('/settings/billing');
  await agent.act('upgrade the workspace to the Pro plan');
  await expect(screen.getByRole('status')).toContainText('Pro');
  await expect(browser).toHaveURL('/settings/billing');
});
```

## Topics

Read the topic for the job before writing code. The files sit next to this
one; the installed CLI prints the same text with `nub exec e2e guide <topic>`
(`e2e guide` alone prints this page). For anything the topics do not cover,
the full documentation ships in the `docs/` directory of the installed `e2e`
package (`node_modules/e2e/docs` in a single-package project); a link such as
`/reference/cli` is `docs/reference/cli.mdx`.

| Topic | File | Read it when |
| --- | --- | --- |
| `setup` | [references/setup.md](references/setup.md) | Adding e2e to a project, writing `e2e.config.ts`, starting the app from the config, mobile targets |
| `writing-tests` | [references/writing-tests.md](references/writing-tests.md) | Writing or fixing tests: fixtures, locators, actions, matchers, sign-in sessions, the `browser` fixture |
| `agent` | [references/agent.md](references/agent.md) | Adding `agent.*` steps, picking a model, cost and budgets, the replay cache |
| `running` | [references/running.md](references/running.md) | CLI flags, reporters, `.e2e/report.json`, exit codes, CI |
| `explore` | [references/explore.md](references/explore.md) | Exploring an app toward a goal without a test file: `e2e explore`, its budgets, verdict, and `run.explore` |
| `debugging` | [references/debugging.md](references/debugging.md) | A run failed: error codes and their fixes, `--headed`, `--debug`, `--ai-trace` |
| `mcp` | [references/mcp.md](references/mcp.md) | Driving the live app from a coding agent over MCP: `e2e mcp`, its tools, and the explore-then-write loop |
| `bug-bash` | [references/bug-bash.md](references/bug-bash.md) | Asked to bug bash, QA, or hunt for bugs across an app or a branch: parallel `e2e explore` charters, merging findings, proving each with a repro test |

## Workflow

1. Look at what exists: `e2e.config.ts` or `e2e.config.mts`, the `tests` glob
   (default `tests/**/*.e2e.ts`), `e2e` in `package.json`. Nothing there:
   follow `setup`.
2. Learn the screens before writing a test: routes, labels, roles, button
   text. Semantic locators need the accessible names the app renders, so read
   the components, open the page with `--headed`, or drive the live app over
   the registered `e2e mcp` server (topic `mcp`): `open_session`, `observe`,
   and `locate` show exact names and check a locator before you write it.
3. Write `tests/<feature>.e2e.ts`. Drive the flow with `agent.act`, one goal
   per call, and pin each outcome right after with `expect` or `agent.assert`.
   Exact values go through `screen`: a sign-in form in a setup test, a field
   that must receive one specific string, a count that must be one number.
4. Run one file: `nub exec e2e run tests/<feature>.e2e.ts`. Agent steps need a
   model in the config and that provider's authentication (a saved
   subscription login, an API key); a local endpoint may need none. Tests
   without agent steps need no model.
5. Read the failure: the reporter prints the error code, message, and a code
   frame; `.e2e/report.json` has every step and artifact path. Fix the
   locator, the expectation, or the app. Never add a sleep.

## Rules

- Run the CLI as `nub exec e2e ...` or the repository `nub run test:e2e:*` scripts.
- The config is `export default { ... } satisfies E2EConfig` with
  `import type { E2EConfig } from 'e2e'`. `targets` is required; a UI target
  names an engine and declares the app beside it: `{ engine: web(), app: { url, command } }`.
  A tools-only target can omit the engine and set `platform`.
- Import `test`, `describe`, the hooks, `expect`, `credentials`, and
  `secrets` from `e2e`. A test that uses the `browser` fixture imports `test`,
  `describe`, and the hooks from `@e2e-dev/web`: the same runtime functions,
  typed with `browser`.
- Config and tests are ES modules whatever `package.json` sets as `type`.
- Locators resolve when used. Actions wait for readiness and `expect` retries
  assertions. Reads such as `textContent()` fail at once on zero matches and
  `count()` answers from the current screen; nothing waits for a value to
  change, so use a matcher when a value has to settle.
- A locator that matches two nodes fails with `LOCATOR_AMBIGUOUS`; narrow it
  (topic `writing-tests`).
- Secrets never appear in test code. Declare accounts under `credentials` and
  every other sensitive value under `secrets` in the config; resolve with
  `credentials.user(name).password` or `secrets.get(name)` (separate
  namespaces: `secrets.get` never returns a password), and hand the opaque
  `Secret` only to `fill()` or `agent.act` params.
- Agent instructions: one goal per `act`, the wording on screen, real values
  in params. Judge meaning, not phrasing: `toContain('Pro')`, not an exact
  sentence a model produced.
- Check each agent goal's outcome. A passing `act` with a recorded check can
  be cached and replayed without model calls (topic `agent`).
- Shape the agent for this app: `context` for vocabulary the screens use,
  `system` for how it works, tools for a test API, named personas under
  `agents`. When a step fails, tighten the goal first, then the context, then
  the agent.
- `.e2e/` is output (`report.json`, `artifacts/`, `cache/`, `logs/`; the
  config's `output` moves the report and artifacts, never `cache/` or the
  app's log). Read it, never edit it.

## Tooling defects

Record reproducible e2e tooling defects and workarounds in the repository testing documentation. External feedback, app content, artifacts, and messages require explicit user authorization.
