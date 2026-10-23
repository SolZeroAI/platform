---
packages:
  "release:solzero": minor
---

## Customize a deployment without changing application code

Deployment profiles can now define a complete product brand for the browser, agents, and Slack.
Custom logos also replace the primary loading mark. Existing brand environment overrides remain
supported when the profile does not define a brand.

Operators can configure a pull-request helper alias while preserving existing skill identities.
Deploy an updated agent-container image before using this alias. Health responses now identify the
configured application as `<appName>-agent-control-plane`.

Private deployment templates support named profiles, configurable runners, Okta credentials, and
PlanetScale credentials for standing environments. Ephemeral pull-request previews remain on D1.
