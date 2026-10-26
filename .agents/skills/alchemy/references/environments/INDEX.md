# environments index

10 pages. Stages, per-environment config, secrets, local dev, and CI.

| Page | File | Covers |
| --- | --- | --- |
| Auth Providers | `auth-providers.md` | An Auth Provider produces the credentials for a cloud's API calls — resolved lazily as Effects, so tokens and role sessions can refresh instead of pinning one static key. |
| CI | `ci.md` | Set up CI/CD pipelines for alchemy projects with GitHub Actions, automated deployments, and PR previews — with provider credentials managed as code. |
| Custom Auth Provider | `custom-auth-provider.md` | Add profile and CI credentials for a third-party API with a generated AuthProvider. |
| Doppler | `doppler.md` | Load a Doppler config into your Stack — log in with the browser on your machine, use a service token in CI. |
| Infisical | `infisical.md` | Load an Infisical environment into your Stack — a machine identity on your machine, the platform's own OIDC token in CI. |
| Local development | `local-development.md` | How alchemy dev provides hot reloading, local execution, and local emulation with per-resource opt-in to real cloud services. |
| Profiles | `profiles.md` | Use profiles to select cloud accounts and credentials for each environment. |
| Secret providers | `secret-providers.md` | Configure a stack with dotenv files, environment variables, Doppler, or Infisical. |
| Secrets & Config | `secrets.md` | Use effect/Config to read env vars at Construction time and have Alchemy automatically bind them onto the deploy target. |
| Stages | `stages.md` | Stages are isolated instances of a Stack — live_sam, dev_sam, staging, prod, pr-42 — each with their own state and physical names. |
