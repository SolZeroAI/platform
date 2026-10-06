---
name: verify-solzero
description: Drive the SolZero web app (TanStack Start + Kumo on :3000, API Worker on :3100) to prove user-facing behavior. Use when verifying sign-in, Agents, Workflows, Bots, or Settings against a local Alchemy `nub run dev` stack, or when running tester-army/e2e.
---

# Verify SolZero

SolZero is a platform. A user actually touches the web app at `http://localhost:3000`: credential sign-in, the Isolate Agent composer, Workflows, always-on bots, and Settings. Admin (`/admin/*`) is an admin-gated sidebar disclosure for the same local admin user. It is not a mapped feature file. The Effect API Worker at `http://localhost:3100` is the control plane behind the web `/api` BFF. `nub` scripts are operator surfaces, not the primary user path.

Drive the UI with `control-solzero chrome` (headless Chrome DevTools). Drive the control plane with `control-solzero http`. Read `features/README.md` before clicking anything. Automated regression lives in tester-army/e2e under `tests/**/*.e2e.ts`. Read `.agents/skills/e2e/SKILL.md` and `docs/e2e.md` before running or extending that suite. Do not treat e2e recordings as a substitute for a mapped live-drive.

Use Node 24.15 and Nub 0.4.11. Ports `3000` and `3100` are exclusive (`strictPort: true` on the Vite website; the API Worker binds `3100`). Alchemy also uses `/.alchemy` and the repo `.alchemy/` directory. Two stacks cannot run side by side. If those ports already belong to someone else, refuse. Do not double-drive a leftover `nub run dev` you did not start.

## Launch

From the repo root:

```bash
.cursor/skills/verify-solzero/control-solzero launch
.cursor/skills/verify-solzero/control-solzero doctor
```

Ready means launch prints `ready web=http://localhost:3000 api=http://localhost:3100` and doctor prints only `ok` lines plus `doctor ok`. Launch and doctor also require `GET http://localhost:3100/api/auth/config` to return a credential sign-in provider. Health-only ready is not enough. The local welcome surface is the credential form (`#admin-email`, `#admin-password`, **Sign In**). If that config call fails, doctor must fail closed. An unconfigured welcome (`Sign-in is not configured for this deployment.`) is a product failure, not a mapped feature.

`launch` will:

1. Refuse if `:3000` or `:3100` is already listening and is not this verification run.
2. Create `config/.env` from `config/.env.example` only when that file is missing, copying `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the process environment. That file is verification scaffolding. Cleanup removes it only if this run created it.
3. Create `config/.dev.vars` from `config/.dev.vars.example` only when that file is missing. Same scaffolding rule.
4. Source `config/.env`, export `CI=1` so Alchemy accepts `CLOUDFLARE_*` env credentials in a non-interactive process, ensure `/.alchemy` exists, require a running Docker engine (README prerequisite; without it workerd binds the ports and then hangs), and start detached `nub run dev` (Alchemy API + web). Logs go to `.cursor/skills/verify-solzero/.run/dev.log`.
5. Wait until `GET http://localhost:3100/health` returns JSON `status=healthy` / `service=s0-agent-control-plane` and `GET http://localhost:3000/` returns HTML. Then require `GET http://localhost:3100/api/auth/config` to return a credential sign-in provider.

Do not run `nub run infra:deploy:*`. Do not run `db:copy-d1-to-planetscale`. Do not bump Alchemy, Effect, Wrangler, Better Auth, or `ai`/`chat` pins.

Teardown is `control-solzero cleanup`. See Cleanup.

## Doctor

```bash
.cursor/skills/verify-solzero/control-solzero doctor
```

Exit 0 only when `.run/meta.json` exists, health JSON is healthy, the web origin answers with SolZero HTML, `GET /api/auth/config` returns a credential sign-in provider, and the listeners on `:3100` and `:3000` are the PIDs recorded at launch.

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
3. UI through Chrome DevTools. The helper starts `/opt/google/chrome/chrome` with a disposable profile and a free loopback DevTools port. Do not invoke the `google-chrome` wrapper; it can attach to an existing desktop Chrome. Relative `--out` paths resolve from `.cursor/skills/verify-solzero/` only if you pass them that way; prefer `$ART/...`. Each `chrome` invocation starts a new headless Chrome with a unique profile (`drive.mjs` appends the process id). Session cookies from `chrome sign-in` do not carry into a later `chrome dump` or `screenshot`. Use `chrome signed-in-open` (same Chrome process: sign in, then open the URL) for authenticated proof of `/workflows`, `/bots`, or `/settings`.
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
| `Email` / `Password` | field labels | sign-in |
| `#admin-email` | email textbox | sign-in |
| `#admin-password` | password textbox | sign-in |
| `Sign In` | submit button | sign-in |
| `Agents` | sidebar link to `/#new-agent` | authenticated shell |
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
.cursor/skills/verify-solzero/control-solzero chrome signed-in-open \
  --url http://localhost:3000/workflows \
  --email admin@example.com \
  --out-dir "$ART/workflows"
```

`admin-password` reads the Worker-bound secret from local Alchemy disk state (`packages/infra/.alchemy/state/S0/dev/admin-password.json`, or the `S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD` binding in `api.json`). Use this helper. `nub run auth:admin-password -- dev --local` now reads that same disk file. Do not use `nub run auth:admin-password` without `--local`, or Cloudflare `alchemy state get`: those can return a different `attr.text` than the bound secret, and `POST /api/auth/sign-in/email` rejects that value.

## Automated e2e

The isolated tester-army/e2e launcher starts its own Alchemy stack on the same exclusive ports and refuses an existing stack. Coordinate with other projects before starting the suite. Docker must be running.

```sh
nub install --frozen-lockfile
nub run test:e2e:install
E2E_ENV_FILE=/path/to/private.env nub run test
nub run test:e2e:live tests/auth.e2e.ts
nub run test:e2e:cache-strict
nub run test:e2e:list
```

The environment loader reads the selected private file, then `config/.env` and `config/.dev.vars`; existing environment values win. Supply the documented Cloudflare account, application, and Clef gateway credentials. Never print their values. The launcher creates its owned run’s `.dev.vars` with mode 0600 and generates the isolated administrator password in an ignored file. Use the suite's registered secret handles for browser credential input.

`nub run test` runs core flows, including real source-image OpenCode and Codex prompts, tools, follow-ups and persisted history. `nub run test:e2e:all` adds the deferred external integrations and Claude Code; `nub run test:e2e:external` selects only those deferred cases. Read the fixture inventory in `docs/e2e.md` first. Missing integration credentials or linked identities are blockers, and collection alone does not establish coverage.

Cloudflare Clef (`@cf/cloudflare/clef`) through AI Gateway supplies semantic actions and visual assertions. Follow each action with an exact deterministic assertion. Use `expect` for waiting; this executor supports `act` and `assert` only.

Read `.e2e/report.json`, `.e2e/summary.md`, failure evidence, and the ignored stack log. Distinguish live execution from strict replay and identify any unverified external flows. Raw network/browser traces are disabled because dynamically minted credentials cannot be registered for redaction by the published SDK. Retain sanitized screenshots and reports, keep secrets out of model observations, and leave credential displays before failure capture.

After the local e2e launcher stops, remove its account-level test resources with the same private credential file, account and isolated profile used for the run:

```sh
E2E_ENV_FILE=/path/to/private.env nub run test:e2e:cleanup
```

If the run selected `E2E_CONFIG_PROFILE`, retain that selection for cleanup. Keep the same `CI` setting: gateway/token names contain a unique run UUID and local/CI scopes are separate, and the ownership guard refuses a scope mismatch. The command validates persisted gateway/token/account ownership and local Worker names before invoking normal Alchemy destruction; it deletes the dedicated gateway, revokes its generated application run token and removes only that run’s simulator data, build contexts and labelled containers/images. Preserve replay cache, shared `default`, production gateways and unrelated or unknown remote resources. Do not bypass a guard or delete resources based only on names. Default commands verify guarded cleanup automatically, including after startup/test failure and cancellation. Use `nub run test:e2e:lifecycle` to prove SIGTERM, SIGKILL, orphaned descendants, intentional suite failure, cancellation, failed process inspection/publication and idempotence. On this repository, dispatch the same suite with `gh workflow run validate.yml -f e2e_lifecycle=true` (the boolean is opt-in on `validate.yml`; it is not a `feat/e2e` branch). Preserve private failed receipts; safe CI ownership metadata can recover a lost runner only after immutable same-repository completed-run verification. See `docs/e2e.md` for the explicit recovery command and remote preview limitations.

The e2e launcher owns process cleanup for its isolated stack; stop only its recorded processes and preserve unrelated development stacks. Delete temporary integration fixtures and revoke minted tokens in `finally` blocks. Keep new automated regression cases in `tests/**/*.e2e.ts`. Use `control-solzero` for agent live-drive of the mapped features.

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
.cursor/skills/verify-solzero/control-solzero chrome signed-in-open --url http://localhost:3000/workflows --email admin@example.com --out-dir artifacts/<runId>/workflows
.cursor/skills/verify-solzero/control-solzero chrome create-bot --name verify-bot-<runId> --email admin@example.com --out-dir artifacts/<runId>/bot-created
.cursor/skills/verify-solzero/control-solzero artifact-dir
.cursor/skills/verify-solzero/control-solzero urls
.cursor/skills/verify-solzero/control-solzero paths
.cursor/skills/verify-solzero/control-solzero cleanup
```

`config/.env` and `config/.dev.vars` created by launch are verification scaffolding. Cleanup removes only the copies this run created.

Do not invent flags. Read the script if stdout is confusing.

Feature recipes: `features/`.
