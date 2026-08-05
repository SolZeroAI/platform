FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SANDBOX_ROOT=/workspace
ENV WORKSPACE_ROOT=/workspace/repo

RUN npm install --global @nubjs/nub@0.4.11 \
  && npm install \
  @ai-sdk/harness@1.0.41 \
  @ai-sdk/harness-opencode@1.0.42 \
  @ai-sdk/harness-codex@1.0.43 \
  @ai-sdk/harness-claude-code@1.0.42 \
  @modelcontextprotocol/sdk@1.29.0

RUN groupadd --gid 10001 s0 \
  && useradd --uid 10001 --gid s0 --create-home --shell /bin/bash s0 \
  && mkdir -p /workspace/repo \
  && chown -R s0:s0 /app /workspace /home/s0

ENV HOME=/home/s0

RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'cert=/etc/cloudflare/certs/cloudflare-containers-ca.crt' \
  'if [ -f "$cert" ]; then' \
  '  bundle=/tmp/s0-ca-certificates.crt' \
  '  cat /etc/ssl/certs/ca-certificates.crt "$cert" > "$bundle"' \
  '  export NODE_EXTRA_CA_CERTS="$cert"' \
  '  export SSL_CERT_FILE="$bundle"' \
  '  export CURL_CA_BUNDLE="$bundle"' \
  '  export REQUESTS_CA_BUNDLE="$bundle"' \
  '  export GIT_SSL_CAINFO="$bundle"' \
  'fi' \
  'exec node /app/index.mjs' \
  > /usr/local/bin/s0-agent-container \
  && chmod +x /usr/local/bin/s0-agent-container

COPY index.mjs /app/index.mjs
COPY *.js /app/

USER s0

EXPOSE 8787

ENTRYPOINT ["/usr/local/bin/s0-agent-container"]
