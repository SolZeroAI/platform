# Sign-in

Credential sign-in is the default local welcome screen. An unauthenticated visit to `/` renders `SignInPage` with email, password, and Sign In. After a successful Better Auth email sign-in, the same URL shows the Agents home.

## Sub-features

- `welcome-form` shows `Welcome to SolZero`, `Give your work an agent`, `#admin-email`, `#admin-password`, and a `Sign In` submit button.
- `credential-submit` signs in `admin@example.com` with the Alchemy-generated admin password and lands on the Agents composer.
- `account-menu` exposes `Account menu` and `Sign out` in the sidebar footer after sign-in.

## How to get to it (user POV)

1. Open `http://localhost:3000/`.
2. If you are signed out, you stay on `/` and see the welcome form. There is no separate `/login` route.
3. Enter an address from `config/dev.config.jsonc` `admins.adminEmails` and the password from `nub run auth:admin-password -- dev --local`.
4. Click **Sign In**.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/ --out "$ART/sign-in.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/ --out "$ART/sign-in.png"
```

`sign-in.html` and `sign-in.html.text` must contain `Welcome to SolZero`, `admin-email`, `admin-password`, and `Sign In`.

To complete sign-in:

```bash
.cursor/skills/verify-solzero/control-solzero admin-password
export SOLZERO_VERIFY_ADMIN_PASSWORD="$(cat .cursor/skills/verify-solzero/.run/admin-password)"
.cursor/skills/verify-solzero/control-solzero chrome sign-in \
  --url http://localhost:3000/ \
  --email admin@example.com \
  --out-dir "$ART/signed-in"
```

Ready when `$ART/signed-in/result.txt` is `signed-in` and `$ART/signed-in/after.text` contains `Agents` plus the composer placeholder `Chat, build, and automate with project context`.

## Gotchas

- The welcome heading is reused on the signed-in home. Do not treat `Welcome to SolZero` alone as proof of sign-in. Look for `#admin-email` (signed out) versus `textarea.session-composer-textarea` (signed in).
- `control-solzero admin-password` needs Alchemy local state. If it fails, launch has not finished generating secrets; do not invent a password.
- Social/OIDC buttons only appear when those providers are enabled in the stage JSONC. Local `dev.config.jsonc` ships credential-only.
- Do not POST `/api/auth/sign-in/email` from curl and call that a UI proof. HTTP is fine as a side-effect check after the Chrome submit.
