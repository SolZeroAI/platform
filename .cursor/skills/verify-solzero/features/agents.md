# Agents

Agents is the signed-in home. A user writes a prompt, picks an Isolate (or sandbox) runtime and model, and sends. Previous sessions live on the same page under a scroll target and a sidebar hash link.

## Sub-features

- `new-agent-composer` shows the prompt textarea (`Chat, build, and automate with project context`) and a `Send` button.
- `runtime-toolbar` opens the Agent runtime dialog from the toolbar button labeled `Agent runtime: …`.
- `previous-sessions` scrolls to `Previous sessions` via the sidebar link or the home cue button (`aria-label="Previous sessions"`).
- `session-route` opens `/session/$id` after a successful send.

## How to get to it (user POV)

1. Sign in (see `sign-in.md`).
2. Land on `/`. The hero still says `Welcome to SolZero`.
3. Type in the composer. Optionally open runtime, secrets, repository, tools, or model controls in the toolbar.
4. Click **Send** (circle button, `aria-label="Send"`) or press Enter.
5. Open **Previous sessions** from the sidebar under Agents, or use the down-arrow cue on the home hero.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
# after sign-in
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/ --out "$ART/agents-home.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/ --out "$ART/agents-home.png"
```

`agents-home.html.text` must contain `Agents`, the composer placeholder, and `Previous sessions`.

Sending a prompt that calls a model needs a configured provider. If the toolbar shows the AI-provider-required control instead of a model name, record that precondition and stop. Do not mark Agents verified by stubbing the gateway.

`nub run test:e2e` (`tests/e2e/session-run-api.test.ts`) is an API-key harness against `:1337`. Use it only when the change is the session-run API and `S0_API_KEY` is set. It does not prove the composer.

## Gotchas

- `#new-agent` and `#previous-sessions` hashes are cleared after scroll. Drive by visible copy and the textarea class `session-composer-textarea`, not by a lingering hash.
- Repository-backed sessions need a linked GitHub account. Isolate without a repo is the default local path.
- Mini Apps in the sidebar is `coming soon` and is not a feature to drive.
