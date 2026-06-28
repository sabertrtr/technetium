#!/usr/bin/env bash
# Deploy Technetium's production build to tc.41chan.net.
# Builds from the current working tree, ships to a hash-named release dir on the
# Hetzner origin, flips the 'current' symlink, prunes to the last 5 releases.
# Driven from vesper; reaches the origin via the 41chan-origin SSH alias.
set -euo pipefail

REMOTE="41chan-origin"
REMOTE_BASE="/srv/tc"
KEEP=5

cd "$(dirname "$0")"

HASH="$(git rev-parse --short HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then HASH="${HASH}-dirty"; fi
RELEASE="$(date +%Y%m%d-%H%M%S)-${HASH}"
REMOTE_DIR="${REMOTE_BASE}/releases/${RELEASE}"

echo ">> building (vite production)"
npm run build

echo ">> shipping dist/ -> ${REMOTE}:${REMOTE_DIR}"
ssh "$REMOTE" "mkdir -p '${REMOTE_DIR}'"
scp -q -r dist/. "${REMOTE}:${REMOTE_DIR}/"

echo ">> flipping current -> ${RELEASE}"
ssh "$REMOTE" "ln -sfn '${REMOTE_DIR}' '${REMOTE_BASE}/current'"

echo ">> pruning to last ${KEEP} releases"
ssh "$REMOTE" "cd '${REMOTE_BASE}/releases' && ls -1dt */ | tail -n +$((KEEP+1)) | xargs -r rm -rf"

echo ">> deployed: ${RELEASE}"
ssh "$REMOTE" "readlink '${REMOTE_BASE}/current'"
