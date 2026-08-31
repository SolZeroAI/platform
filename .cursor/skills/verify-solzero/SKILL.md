---
name: verify-solzero
description: Drive the SolZero web app (TanStack Start + Kumo on :3000, API Worker on :1337) to prove user-facing behavior. Use when verifying sign-in, Agents, Workflows, Bots, or Settings against a local Alchemy `nub run dev` stack.
---

# Verify SolZero

SolZero is a platform. A user actually touches the web app at `http://localhost:3000`: credential sign-in, the Isolate Agent composer, Workflows, always-on bots, Settings, and Admin. The Effect API Worker at `http://localhost:1337` is the control plane behind the web `/api` BFF. `nub` scripts and `BackgroundSessionsClient` are operator/library surfaces, not the primary user path.

There is no Playwright or Cypress project. Existing automated harnesses are Vitest unit/integration suites plus `nub run test:e2e` (API-key session runs against `:1337`). Drive the UI with `control-solzero chrome` (headless Chrome DevTools). Drive the control plane with `control-solzero http`. Read `features/README.md` before clicking anything.

Ports `3000` and `1337` are exclusive (`strictPort: true` on the Vite website; the API Worker binds `1337`). Alchemy also uses `/.alchemy` and the repo `.alchemy/` directory. Two stacks cannot run side by side. If those ports already belong to someone else, refuse. Do not double-drive a leftover `nub run dev` you did not start.

## Launch

From the repo root:

```bash
.cursor/skills/verify-solzero/control-solzero launch
.cursor/skills/verify-solzero/control-solzero doctor
```

Ready means launch prints `ready web=http://localhost:3000 api=http://localhost:1337` and doctor prints only `ok` lines plus `doctor ok`.

`launch` will:

1. Refuse if `:3000` or `:1337` is already listening and is not this verification run.
2. Create `config/.env` from `config/.env.example` only when that file is missing, copying `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the process environment. That file is verification scaffolding. Cleanup removes it only if this run created it.
3. Create `config/.dev.vars` from `config/.dev.vars.example` only when that file is missing. Same scaffolding rule.
4. Source `config/.env`, ensure `/.alchemy` exists, and start detached `nub run dev` (Alchemy API + web). Logs go to `.cursor/skills/verify-solzero/.run/dev.log`.
5. Wait until `GET http://localhost:1337/health` returns JSON `status=healthy` / `service=s0-agent-control-plane` and `GET http://localhost:3000/` returns HTML.

Do not run `nub run infra:deploy:*`. Do not run `db:copy-d1-to-planetscale`. Do not bump Alchemy, Effect, Wrangler, Better Auth, or `ai`/`chat` pins.

Teardown is `control-solzero cleanup`. See Cleanup.

## Doctor

```bash
.cursor/skills/verify-solzero/control-solzero doctor
```

Exit 0 only when `.run/meta.json` exists, health JSON is healthy, the web origin answers with SolZero HTML, and the listeners on `:1337` and `:3000` are the PIDs recorded at launch.

If doctor fails, stop. Do not click around in whatever happens to be bound to those ports. Dump `.run/dev.log` into the artifact directory, then `cleanup`.

Inspect paths with:

```bash
.cursor/skills/verify-solzero/control-solzero paths
.cursor/skills/verify-solzero/control-solzero urls
.cursor/skills/verify-solzero/control-solzero artifact-dir
```

## Drive

Use `http://localhost:3000`, not `http://127.0.0.1:3000`. Better Auth trusted origins include both, but the documented user URL is localhost.

Order:

1. `control-solzero doctor`
2. HTTP checks through the helper so evidence is written:
   ```bash
   ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
   .cursor/skills/verify-solzero/control-solzero http GET /health --out "$ART/health.json"
   .cursor/skills/verify-solzero/control-solzero http GET http://localhost:3000/ --out "$ART/web-root.html"
   ```
3. UI through Chrome DevTools. Relative `--out` paths resolve from `.cursor/skills/verify-solzero/` only if you pass them that way; prefer `$ART/...`.
   ```bash
   .cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/ --out "$ART/sign-in.html"
   .cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/ --out "$ART/sign-in.png"
   ```
4. After each meaningful action, dump or screenshot again. Do not assume the next screen.

Stable handles (from `apps/web/src/routes/_authenticated.tsx` and the sidebar):

| Name | Kind | Where |
| --- | --- | --- |
| `Welcome to SolZero` | heading | sign-in and home |
| `Give your work an agent` | supporting copy | sign-in |
| `#admin-email` | email textbox | sign-in |
| `#admin-password` | password textbox | sign-in |
| `Sign In` | submit button | sign-in |
| `Agents` | sidebar link to `/` | authenticated shell |
| `Previous sessions` | sidebar hash link / home cue | `/` |
| `Workflows` | sidebar link to `/workflows` | authenticated shell |
| `Bots` | sidebar link to `/bots` | authenticated shell |
| `Settings` | sidebar disclosure | authenticated shell |
| `Account menu` | aria-label | sidebar footer |
| `Sign out` | button | account popover |
| `Chat, build, and automate with project context` | composer placeholder | home |
| `Send` | composer submit aria-label | home |
| `Always-on bots` | heading | `/bots` |
| `Bot name` / `Create bot` | form | `/bots` |
| `Create a new Workflow` | heading | `/workflows` |
| `Template` / `Build with AI` / `Import` | creation cards | `/workflows` |

Default local admin email is `admin@example.com` (`config/dev.config.jsonc` `admins.adminEmails`). Retrieve the generated password only through the helper. Do not log it.

```bash
.cursor/skills/verify-solzero/control-solzero admin-password
# writes .run/admin-password; prints the file path, not the secret
export SOLZERO_VERIFY_ADMIN_PASSWORD="$(cat .cursor/skills/verify-solzero/.run/admin-password)"
.cursor/skills/verify-solzero/control-solzero chrome sign-in \
  --url http://localhost:3000/ \
  --email admin@example.com \
  --out-dir "$ART/signed-in"
```

`nub run test:e2e` needs `S0_API_KEY` and a live model path. It does not prove the web UI. Use it only when the feature file says so.

## Evidence

Artifact directory:

```bash
.cursor/skills/verify-solzero/control-solzero artifact-dir
```

That prints `.cursor/skills/verify-solzero/artifacts/<runId>/` and creates it. Proof stays there after cleanup. `.run/` does not.

Standards:

- Drive the web app through `control-solzero chrome` or a real browser against `http://localhost:3000`. Do not import TanStack route modules and call that a user proof.
- Capture the action and the resulting state. A final screenshot with no prior dump is not a proof.
- Named files: `health.json` plus `$out.status` / `$out.headers` / `$out.exit` from `http`; `*.html` + `*.html.text` from `chrome dump`; `*.png` from `chrome screenshot`.
- For mutations (sign-in, create bot, create workflow), prove persistence from a second user-facing view (reload, sidebar navigation, or sign out and sign in).
- Side effects: session cookie after sign-in, a bot card on `/bots`, a workflow row on `/workflows`. `GET /health` is only for doctor.
- Mocks only at production boundaries (Cloudflare AI Gateway, Slack, GitHub App). Do not stub Better Auth or the Vite app.
- If a mapped entry point is blocked, record the click you attempted and the unmet precondition. Do not mark it verified via a unit test.

## Cleanup

```bash
.cursor/skills/verify-solzero/control-solzero cleanup
```

Kills only the PIDs recorded under `.run/` (launcher pid plus the listen pids captured after ready). It never `pkill nub`, `pkill wrangler`, or `killall node`.

Leaves in place:

- `artifacts/<runId>/`
- `/.alchemy` and repo `.alchemy/` (Alchemy state; shared with ordinary local dev)
- `config/.env` and `config/.dev.vars` unless this run created those files

If launch or doctor fails, run `cleanup` before trying again so ports are not stranded. Cleanup copies a 200KB tail of `.run/dev.log` into the artifact dir first. It does not delete `artifacts/`.

## Helpers

Script: `.cursor/skills/verify-solzero/control-solzero` (executable). Chrome steps call `drive.mjs`.

```bash
.cursor/skills/verify-solzero/control-solzero launch
.cursor/skills/verify-solzero/control-solzero doctor
.cursor/skills/verify-solzero/control-solzero http GET /health --out artifacts/<runId>/health.json
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/ --out artifacts/<runId>/sign-in.html
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/ --out artifacts/<runId>/sign-in.png
.cursor/skills/verify-solzero/control-solzero admin-password
.cursor/skills/verify-solzero/control-solzero chrome sign-in --url http://localhost:3000/ --email admin@example.com --out-dir artifacts/<runId>/signed-in
.cursor/skills/verify-solzero/control-solzero artifact-dir
.cursor/skills/verify-solzero/control-solzero urls
.cursor/skills/verify-solzero/control-solzero paths
.cursor/skills/verify-solzero/control-solzero cleanup
```

`config/.env` and `config/.dev.vars` created by launch are verification scaffolding. Cleanup removes only the copies this run created.

Do not invent flags. Read the script if stdout is confusing.

Feature recipes: `features/`.
