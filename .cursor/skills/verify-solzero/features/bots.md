# Bots

Bots is the always-on bot list at `/bots`. A signed-in user names a bot, adds instructions, and creates it. The create action navigates to `/bots/$botId`.

## Sub-features

- `index-empty` shows `Always-on bots` and either `No bots yet` or a list of bot cards.
- `create-bot` submits `Bot name` plus optional `Bot instructions` via **Create bot**.
- `bot-detail` opens `/bots/$botId` after create.

## How to get to it (user POV)

1. Sign in.
2. Click **Bots** in the sidebar.
3. Fill **Bot name**. Optionally fill **Bot instructions**.
4. Click **Create bot**.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome signed-in-open \
  --url http://localhost:3000/bots \
  --email admin@example.com \
  --out-dir "$ART/bots"
.cursor/skills/verify-solzero/control-solzero chrome create-bot \
  --name "verify-bot-<runId>" \
  --email admin@example.com \
  --out-dir "$ART/bot-created"
```

`bots/after.text` must contain `Always-on bots` and `Create bot`. Empty state copy is `No bots yet`. Unauthenticated visits render the welcome form on the same URL. Do not use a later `chrome dump` as a signed-in proof. The instructions field accessible name is `Bot instructions`; its placeholder is `Instructions for this bot`.

Create a unique name per run (`verify-bot-<runId>`). `create-bot` is ready when `after.text` contains the name. Prefer the detail page (`Create a routine` plus `/bots/$botId`). If the URL changes before that page paints, the command re-opens `/bots` and waits for the card. Re-open `/bots` with `signed-in-open` to prove persistence.

## Gotchas

- Create posts to `/api/bots`. A toast error without a new card is a failed create, not a UI-only glitch.
- Temporary routines and optional GitHub PR watches are detail-page work. There is no Slack watch UI. Do not mark them verified from the index screenshot.
- The Create bot button stays disabled until the name is non-empty.
