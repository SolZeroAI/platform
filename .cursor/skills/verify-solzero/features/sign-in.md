# Sign-in

Credential sign-in is the default local welcome screen. An unauthenticated visit to `/` renders `SignInPage` with email, password, and Sign In. After a successful Better Auth email sign-in, the same URL shows the Agents home.

## Sub-features

- `welcome-form` shows `Welcome to SolZero`, `Give your work an agent`, `Email`, `Password`, `#admin-email`, `#admin-password`, and a `Sign In` submit button.
- `credential-submit` signs in `admin@example.com` with the Alchemy-generated admin password and lands on the Agents composer.
- `account-menu` exposes `Account menu` and `Sign out` in the sidebar footer after sign-in. `chrome sign-in` does not open the popover.

## How to get to it (user POV)

1. Open `http://localhost:3000/`.
2. If you are signed out, you stay on `/` and see the welcome form. There is no separate `/login` route.
3. Enter an address from `config/dev.config.jsonc` `admins.adminEmails` and the password from `control-solzero admin-password`.
4. Click **Sign In**.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/ --out "$ART/sign-in.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/ --out "$ART/sign-in.png"
```

`sign-in.html.text` must contain `Welcome to SolZero`, `Email`, `Password`, and `Sign In`. `sign-in.html` must contain `#admin-email` / `#admin-password` (`id="admin-email"`). Before hydration the heading HTML is `Welcome to <!-- -->SolZero`, so do not grep the HTML for the contiguous string `Welcome to SolZero`. The field ids are not in `.text`.

To complete sign-in:

```bash
.cursor/skills/verify-solzero/control-solzero admin-password
export SOLZERO_VERIFY_ADMIN_PASSWORD="$(cat .cursor/skills/verify-solzero/.run/admin-password)"
.cursor/skills/verify-solzero/control-solzero chrome sign-in \
  --url http://localhost:3000/ \
  --email admin@example.com \
  --out-dir "$ART/signed-in"
```

Ready when `$ART/signed-in/result.txt` is `signed-in`, `$ART/signed-in/after.text` contains `Agents` and `Previous sessions`, and `$ART/signed-in/after.html` contains `textarea.session-composer-textarea` plus the placeholder `Chat, build, and automate with project context`. The placeholder is an attribute. It is not in `.text`.

## Gotchas

- The welcome heading is reused on the signed-in home. Do not treat `Welcome to SolZero` alone as proof of sign-in. Look for `#admin-email` (signed out) versus `textarea.session-composer-textarea` (signed in).
- `control-solzero admin-password` reads the Worker-bound secret from `packages/infra/.alchemy/state`. If it fails, launch has not finished writing that file; do not invent a password. Do not use `nub run auth:admin-password` / `alchemy state get`: those return a different `attr.text` than `S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD`, and Better Auth returns `INVALID_EMAIL_OR_PASSWORD`.
- `chrome sign-in` waits for the TanStack Start client script, then `requestSubmit()`. A click before hydration does a native GET and leaves the welcome form with no toast.
- Social/OIDC buttons only appear when those providers are enabled in the stage JSONC. Local `dev.config.jsonc` ships credential-only.
- Do not POST `/api/auth/sign-in/email` from curl and call that a UI proof. HTTP is fine as a side-effect check after the Chrome submit.
- Each `chrome dump` / `screenshot` uses a fresh profile. A later dump does not stay signed in. Use `chrome signed-in-open` to prove `/workflows`, `/bots`, or `/settings` in the same session as Sign In.
- If the welcome copy is `Sign-in is not configured for this deployment.`, stop. That is a product failure. Doctor should already have failed closed on `/api/auth/config`. It is not a mapped empty state.
