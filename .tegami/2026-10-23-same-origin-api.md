---
packages:
  "release:solzero": major
---

## Serve the API from the web origin

The API is now served only at the web application's `/api` path. Public requests route directly to the API Worker, while server-rendered pages use a private service binding. Workflow webhooks, Slack callbacks, agent URLs and OpenAPI use the `/api` base.

**Breaking:** the separate `api.<webFqdn>` hostname and the `deployment.apiFqdn` setting are removed, and configuration files that still set `apiFqdn` fail validation. Update external callers, OAuth provider callbacks, GitHub App webhooks and Slack request URLs to the `/api` base before upgrading a deployment.
