#!/bin/sh
# Regenerate images/manifest.json from whatever is in images/
# (only needed for dumb static hosts — Caddy/serve.js auto-list the folder)
cd "$(dirname "$0")/images" || exit 1
ls | grep -Ei '\.(jpe?g|png|webp|gif|avif)$' | grep -v manifest \
  | sed 's/.*/  "&"/' | sed '$!s/$/,/' \
  | { echo '['; cat; echo ']'; } > manifest.json
echo "wrote images/manifest.json:"; cat manifest.json
