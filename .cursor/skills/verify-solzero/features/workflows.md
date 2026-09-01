# Workflows

Workflows is the builder index at `/workflows`. A signed-in user creates an unsaved draft from a template, a natural-language prompt, or a YAML import. The draft stays on `/workflows` until save. Opening an existing row or saving a draft reaches `/workflows/$workflowId`.

## Sub-features

- `index-landing` shows `Create a new Workflow` and `Existing workflows`.
- `create-template` opens the Template card (`aria-label` starts with `Template.`).
- `create-ai` opens Build with AI (`Build draft` after a prompt).
- `create-import` opens Import (`Choose YAML file`).
- `existing-list` shows the workflows table or an empty list.

## How to get to it (user POV)

1. Sign in.
2. Click **Workflows** in the sidebar (`/workflows`).
3. Choose **Template**, **Build with AI**, or **Import**.
4. Open an existing row to reach `/workflows/$workflowId`.

## Driving it with Chrome DevTools

```bash
ART="$(".cursor/skills/verify-solzero/control-solzero" artifact-dir)"
.cursor/skills/verify-solzero/control-solzero chrome dump --url http://localhost:3000/workflows --out "$ART/workflows.html"
.cursor/skills/verify-solzero/control-solzero chrome screenshot --url http://localhost:3000/workflows --out "$ART/workflows.png"
```

`workflows.html.text` must contain `Create a new Workflow` and the three card titles `Template`, `Build with AI`, and `Import`. Unauthenticated visits render the welcome form on the same URL. Each `chrome` command uses a fresh profile, so dump `/workflows` after `chrome sign-in` is still signed out.

Build-with-AI needs a model provider. Template selection does not. Prefer Template when proving the index without gateway credentials.

## Gotchas

- Unauthenticated visits to `/workflows` render the welcome screen on the same origin. If you see `#admin-email` or `Sign-in is not configured for this deployment.`, you are not on Workflows.
- Admin workflow tools live under `/admin/workflows`. That is a different page. Do not treat it as this feature.
- Import expects a SolZero workflow YAML export. Do not upload an arbitrary file and call a rejection a product failure unless the copy is wrong.
