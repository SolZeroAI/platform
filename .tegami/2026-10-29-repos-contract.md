---
packages:
  "release:solzero": patch
---

## Describe repository responses in the API contract

The OpenAPI document now describes each repository that `GET /repos` returns, with its permissions and stored metadata. The repository metadata endpoints describe the metadata fields. The web app reads repositories through the typed API client.
