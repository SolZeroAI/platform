#!/usr/bin/env bash
# Build the linux/amd64 tree the alchemy.new registry archive packs.
# Install native build libraries (pkg-config, liblzma-dev) before this script.
# The script installs dev dependencies for the build, then prunes them.

set -euo pipefail

cd "$(dirname "$0")/.."

nub install --frozen-lockfile
nub run build
# linux/amd64 is the runner. Prune removes devDependencies.
# The install on this runner already selected linux/amd64.
nub prune --prod
node scripts/materialize-alchemy-package-link.mjs
node scripts/relativize-in-package-symlinks.mjs
