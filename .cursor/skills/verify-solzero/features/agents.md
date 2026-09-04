# Agents

Agents is the signed-in home. A user writes a prompt, picks an Isolate runtime (or OpenCode, Codex, or Claude Code), picks a model, and sends. Previous sessions live on the same page under a scroll target and a sidebar hash link.

## Sub-features

- `new-agent-composer` shows the prompt textarea (`Chat, build, and automate with project context`) and a `Send` button.
- `runtime-toolbar` opens the Agent runtime dialog from the toolbar button labeled `Agent runtime: …`.
- `previous-sessions` scrolls to `Previous sessions` via the sidebar link or the home cue button (`aria-label="Previous sessions"`).
- `session-route` navigates to `/session/$id?boot=1` as soon as Send has a session id. The prompt POST is fire-and-forget and may fail after navigation.

## How to get to it (user POV)

1. Sign in (see `sign-in.md`).
2. Land on `/`. The hero still says `Welcome to SolZero`.
3. Type in the composer. Optionally open runtime, secrets, repository, tools, or model controls in the toolbar.
4. Click **Send** (circle button, `aria-label="Send"`) or press Enter.
5. Open **Previous sessions** from the sidebar under Agents, or use the down-arrow cue on the home hero.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome signed-in-open \
  --url http://localhost:3000/ \
  --email admin@example.com \
  --out-dir "$ART/agents-home"
```

`agents-home/after.text` must contain `Agents` and `Previous sessions`. `agents-home/after.html` must contain `textarea.session-composer-textarea` and the placeholder `Chat, build, and automate with project context`. An unauthenticated dump of `/` is the welcome form, not Agents. Do not use a later `chrome dump` as a signed-in proof.

Sending a prompt that calls a model needs a configured provider. If the toolbar shows the AI-provider-required control instead of a model name, record that precondition and stop. Do not mark Agents verified by stubbing the gateway.

`nub run test:e2e` (`tests/e2e/session-run-api.test.ts`) is an API-key harness against `:1337`. Use it only when the change is the session-run API and `S0_API_KEY` is set. It does not prove the composer.

## Gotchas

- `#new-agent` and `#previous-sessions` hashes are cleared after scroll. Drive by visible copy and the textarea class `session-composer-textarea`, not by a lingering hash. The sidebar Agents link is `/` with hash `new-agent`.
- Repository-backed sessions need a linked GitHub account. Isolate without a repo is the default local path.
- Send stays disabled when the toolbar shows `AI Provider required` (no models). Record that precondition. Do not stub the gateway.
- Mini Apps in the sidebar is `Mini Apps (coming soon)` and is not a feature to drive.
