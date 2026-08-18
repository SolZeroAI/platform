#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d /.alchemy ]]; then
  sudo mkdir -p /.alchemy
  sudo chown "$(id -u):$(id -g)" /.alchemy
fi

if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  sudo dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if [[ -S /var/run/docker.sock ]]; then
    sudo chmod 666 /var/run/docker.sock
  fi
fi
