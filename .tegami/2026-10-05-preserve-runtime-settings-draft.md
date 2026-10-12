---
packages:
  "release:solzero": patch
---

## Preserve unsaved runtime settings

Background provider refreshes no longer discard an edited Isolate step limit when the saved value is unchanged. The input becomes editable after its saved baseline is initialized.
