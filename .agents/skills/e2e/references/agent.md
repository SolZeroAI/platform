# Cloudflare Clef steps

The committed configuration selects `createClefExecutor()` through Cloudflare AI Gateway. Extend that configuration instead of creating a chat-model or Jev executor. This repository supports `agent.act` and visual `agent.assert`; it does not support `agent.waitFor` or `agent.extract`.

Write one bounded semantic goal, then immediately verify the actual outcome:

```ts
await agent.act('Open the About page from the navigation. Stop when its main heading is visible.');
await expect(screen.getByRole('heading', 'About us')).toBeVisible();
```

Use the actual route/label from the application; the example is not a universal product flow. Use deterministic `screen`, `browser`, `app`, `expect` and `expect.poll` checks for precise values and asynchronous state. Prefer exact locator interactions when the intended control is already known.

Clef receives redacted accessible trees and masked/resized screenshots, chooses offered actions, and verifies completion from a fresh observation. `agent.assert` judges current visible evidence with pixels. Missing evidence is inconclusive, not success. Actions require accessible named controls; do not invent hidden controls from an image. Keep model/action budgets and deadlines bounded.

Register credentials as secrets before using them. Pass exact secret handles to the supported typing action; plaintext must not appear in goals, context, screenshots or artifacts. Scope credentials to disposable fixture identities and clean up owned resources in `finally`.

Action replay verifies the recorded end state. Keep an immediate exact assertion after each semantic action. Assertions themselves can make live model calls, and strict-cache mode alone does not establish zero calls. Inspect the report.

Mark fresh fixture data with the SDK's `unique(value)` in `agent.act` params, including
names that the flow enters or finds. This keeps one recording with replacement slots
while exact assertions still use the current value. Keep choices that change the actions,
such as theme direction or a selected plan, as ordinary parameters. An empty recording
store is warmed by a normal read-write run, not `--no-cache`. Verify a warm run's
`self-finalized` step count and zero model calls independently of Gateway cache headers.

Repository flow inventory: `docs/e2e.md`.
