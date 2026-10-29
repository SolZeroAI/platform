---
packages:
  "release:solzero": patch
---

## Show archived chats again

The Data controls settings page lists archived chats again. The `GET /sessions` contract now describes the response that the Worker sends: `sessions`, `total`, and `hasMore`. The contract no longer declares `limit` and `offset`, which the Worker never sent.
