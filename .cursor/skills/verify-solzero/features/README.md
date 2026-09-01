# SolZero verification map

This directory is the maintained source for verifying user-facing SolZero behavior. Read the index before driving the app, then use the matching feature file as the recipe.

Primary surface: web app at `http://localhost:3000`. Secondary: API Worker at `http://localhost:1337` (health, Better Auth, session APIs). Do not treat Vitest suites as a substitute for a mapped UI feature.

## Baseline preconditions

- Run `.cursor/skills/verify-solzero/control-solzero launch` then `doctor`.
- Stay on `http://localhost:3000`. Refuse if doctor says the ports are not this run.
- Default credential admin is `admin@example.com`. Get the password with `control-solzero admin-password`.
- Creating an Isolate session that talks to a model needs a configured Cloudflare AI Gateway or LiteLLM provider. Sign-in, navigation, Workflows empty state, and Bots empty state do not.

## Features

| File | What a user is doing |
| --- | --- |
| [sign-in.md](sign-in.md) | Open SolZero, see the welcome form, sign in with the deployment-managed admin credential |
| [agents.md](agents.md) | Compose a new Isolate agent and open previous sessions |
| [workflows.md](workflows.md) | Open the workflow index and choose Template, Build with AI, or Import |
| [bots.md](bots.md) | Open always-on bots and create a named bot |
| [settings.md](settings.md) | Open Settings categories (AI Providers, Agents, Secrets, Accounts) |

Drive one file per verification pass unless the change spans two surfaces.
