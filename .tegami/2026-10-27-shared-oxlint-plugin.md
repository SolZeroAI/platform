---
packages:
  "release:solzero": patch
---

## Lint with the shared oxlint-plugin-solzero package

Lint rules now come from the `oxlint-plugin-solzero` npm package, which platform, janus, and alchemy.new share. `packages/s0-lint` and the `github:dmmulroy/anti-slop` dependency are removed, and `.oxlintrc.json` is now `oxlint.config.ts`. `nub run lint` is one root Oxlint call and no longer needs `tsx`. Rule names change from `s0-lint/*` to `solzero/*`. `s0-lint/max-file-lines` is Oxlint's `max-lines`, and the duplicate rules `no-effect-ladder`, `no-call-tower`, and `no-return-in-callback` are removed.
