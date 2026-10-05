---
packages:
  "release:solzero": patch
---

## Clean test resources after failures and cancellation

End-to-end runs now isolate simulator data, containers, gateways and application tokens by run ownership and verify their removal after success, failure or cancellation. Interrupted runs retain guarded recovery receipts instead of sweeping shared development data. Preview cleanup verifies the current pull request lifetime and owned resource absence before reporting success.
