# Settings

Settings is the signed-in account console at `/settings`. Categories are query params, not separate routes.

## Sub-features

- `providers` (`?category=providers`) is the default: **AI Providers**.
- `agents` (`?category=agents`) is **Agents** (skills, MCP, agent tabs).
- `secrets` (`?category=secrets`) is **Secrets**.
- `api-access` (`?category=api-access`) is **Accounts** (GitHub, Slack, API keys).
- `data-controls` and `learn-more` are the remaining nav items.

## How to get to it (user POV)

1. Sign in.
2. Open **Settings** in the sidebar, then a child item (`AI Providers`, `Agents`, `Secrets`, `Accounts`, `Data Controls`, `Learn More`).
3. Or go directly to `/settings?category=providers`.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome dump --url "http://localhost:3000/settings?category=providers" --out "$ART/settings-providers.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url "http://localhost:3000/settings?category=providers" --out "$ART/settings-providers.png"
```

`settings-providers.html.text` must contain `Settings` and `AI Providers`. Repeat with `category=agents` or `category=api-access` when those panels changed.

## Gotchas

- Admin integration keys live under `/admin/integrations`, not Settings. User OpenAI/Anthropic/xAI overrides are Settings > AI Providers.
- GitHub App and Slack linking need those integrations enabled in the stage JSONC. If the Accounts panel says they are disabled, that is configuration, not a broken nav.
- Do not paste provider API keys into artifacts. Screenshot the labeled fields, not the secret values.
