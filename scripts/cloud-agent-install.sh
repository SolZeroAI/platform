#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
else
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  . "$NVM_DIR/nvm.sh"
fi

nvm install
nvm alias default "$(tr -d '[:space:]' < .nvmrc)"
export PATH="$(dirname "$(nvm which default)"):$HOME/.nub/bin:$PATH"
hash -r

if ! command -v nub >/dev/null 2>&1; then
  curl -fsSL https://nubjs.com/install.sh | bash
  export PATH="$HOME/.nub/bin:$PATH"
fi

if ! pkg-config --exists liblzma 2>/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y pkg-config liblzma-dev
fi

nub install --frozen-lockfile
