---
packages:
  "release:solzero": patch
---

## Keep sign-in input when the page first opens

The sign-in form now waits until its event handlers are attached before accepting input. This prevents early input from being lost and stops credentials from being submitted as a native GET request during hydration. Authenticated forms show the existing loader until they are interactive.
