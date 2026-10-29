---
packages:
  "release:solzero": patch
---

## Describe workflows, runs and run events in the API contract

The OpenAPI document now describes each workflow, run and run event that the workflow routes return, and the manifest migration that a workflow save applies. The workflows page loads, saves, renames, enables, disables, deletes and runs workflows, and reads runs and run events, through the typed API client. A failed request shows the server's error message.
