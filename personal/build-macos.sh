#!/usr/bin/env bash
# Build the personal macOS fork from the reviewed checkout. Run from any cwd:
#   bash personal/build-macos.sh
# Uses upstream staging/build helpers; no source files or version files rewritten.
# Artifact: ~/Library/Caches/berd-tauri/cargo-target/release/bundle/macos/Berd Personal.app
# Daily use retains the normal Goose profile and external agent logins. This is
# not an isolated test profile. Never run experimental builds against daily data.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
[[ "$(uname -s)" == "Darwin" ]] || { echo "This installer build requires macOS." >&2; exit 1; }

# Keep this distribution independent of upstream updater/signing credentials.
unset BERD_UPDATER_PUBLIC_KEY BERD_UPDATER_ENDPOINT BERD_RELEASE_CHANNELS_FILE
unset BERD_RELEASE_CHANNEL_ID TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
# Personal builds always use the reviewed lock, even if a shell has dev overrides.
unset GOOSE_BIN GOOSE_DEV_CLONE_URL GOOSE_DEV_REMOTE GOOSE_DEV_REF GOOSE_DEV_BRANCH
unset GOOSE_DEV_COMMIT GOOSE_DEV_PACKAGE GOOSE_DEV_BIN GOOSE_DEV_ALLOW_DIRTY
export GOOSE_BACKEND_LOCK_FILE="$repo_root/goose-backend.lock.json"
export BERD_RELEASE_CHANNEL=disabled VITE_UPDATER_ENABLED=false
export VITE_AUTH_GATE=0 VITE_BYO_KEY_PROVIDERS=1 VITE_ENVIRONMENT=development
export VITE_AGENT_TOOLS=0 VITE_AUTOMATIONS=0 VITE_BUILDERBOT=0 VITE_FEEDBACK=0
export VITE_MANAGED_CONNECTIONS=0 VITE_SKILL_DISCOVERY=0 VITE_TELEMETRY_ENFORCED=0
export VITE_VOICE_DICTATION=0
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0

pnpm install --frozen-lockfile
pnpm --filter @aaif/goose-sdk build:ts
GOOSE_DEV_MODE=required GOOSE_BUILD_PROFILE=release ./scripts/ensure-local-goose.sh
GOOSE_BUILD_PROFILE=release ./scripts/prepare-goose-sidecar.sh
export CARGO_TARGET_DIR="$(bash ./scripts/resolve-tauri-cargo-target-dir.sh bundle)"
./scripts/prepare-berdctl-sidecar.sh
./scripts/prepare-catch-sidecar.sh

eval "$(./scripts/resolve-app-version.sh)"
export BERD_APP_VERSION
export VITE_APP_VERSION="${BERD_APP_VERSION_RICH}-personal"
version_config="$(mktemp -t berd-personal-version.XXXXXX.json)"
trap 'rm -f "$version_config"' EXIT
jq -n --arg version "$BERD_APP_VERSION" '{version: $version}' > "$version_config"
pnpm tauri build --ci --bundles app \
  --features berdctl,no-bb-cli-install,no-block-npm-registry,no-block-doctor-checks \
  --config personal/tauri.conf.json --config "$version_config"

app_path="$CARGO_TARGET_DIR/release/bundle/macos/Berd Personal.app"
codesign --force --deep --sign - "$app_path"
codesign --verify --deep --strict "$app_path"
printf 'Personal fork built: %s\n' "$app_path"
