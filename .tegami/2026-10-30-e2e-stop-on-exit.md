---
packages:
  "release:solzero": patch
---

## Stop local end-to-end runs on exit without crash recovery

End-to-end runs are local only, so the test launcher no longer keeps process journals or recovery receipts. When e2e stops the app target, the target stops `alchemy dev`, removes the run's labelled Docker containers and images, and removes its run directory.

The `test:e2e:cleanup` and `test:e2e:lifecycle` scripts, the lifecycle test suite, and the `e2e_lifecycle` input of `Validate` are removed. After a SIGKILL, stop leftover processes by hand.
