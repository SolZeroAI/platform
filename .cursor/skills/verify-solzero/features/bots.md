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
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/bots --out "$ART/bots.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/bots --out "$ART/bots.png"
```

`bots.html.text` must contain `Always-on bots` and `Create bot`. Empty state copy is `No bots yet`.

Create a unique name per run (`verify-bot-<runId>`). After submit, dump `/bots` again and confirm the new card, or dump the detail URL from the navigation.

## Gotchas

- Create posts to `/api/bots`. A toast error without a new card is a failed create, not a UI-only glitch.
- Temporary routines and Slack/GitHub watches are detail-page work. Do not mark them verified from the index screenshot.
- The Create bot button stays disabled until the name is non-empty.
