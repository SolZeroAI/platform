---
packages:
  "release:solzero": patch
---

## Reuse verified browser actions across test runs

End-to-end checks can replay recorded browser actions with fresh fixture data while
still checking exact results. CI restores recordings from the same branch and saves a
new archive after each successful run, including rerun attempts. Reports show action
replay and live model calls separately from AI Gateway response caching.
