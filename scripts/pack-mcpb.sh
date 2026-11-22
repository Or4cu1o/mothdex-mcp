#!/usr/bin/env bash
# Packs the .mcpb (MCP Bundle) of the committed bundle with the pinned mcpb CLI of tools/mcpb, and checks the result.
# Used by the release build and by CI on every pull request, so the first tag does not meet it for the first time.
#
#   scripts/pack-mcpb.sh <out-dir>      writes <out-dir>/mothdex-mcp_<version>.mcpb (the version of package.json)
#
# Run after `pnpm build` and after `pnpm --dir tools/mcpb install --frozen-lockfile --ignore-scripts`.
# Nothing is published and nothing is signed here.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "pack-mcpb: $*" >&2; exit 1; }
for tool in node pnpm unzip cmp sha256sum; do command -v "$tool" >/dev/null 2>&1 || fail "missing tool: $tool"; done

[ -n "${1:-}" ] || fail "usage: $0 <out-dir>"
[ -d tools/mcpb/node_modules/@anthropic-ai/mcpb ] || fail "the mcpb CLI is not installed: pnpm --dir tools/mcpb install --frozen-lockfile --ignore-scripts"
[ -f dist/mothdex-mcp.mjs ] || fail "dist/mothdex-mcp.mjs not found: run pnpm build"
mkdir -p "$1"
out=$(cd "$1" && pwd)
version=$(node -p "require('./package.json').version")
file="$out/mothdex-mcp_${version}.mcpb"

# `pnpm --dir tools/mcpb exec` runs in tools/mcpb, so every path given to it is absolute.
mcpb() { pnpm --dir tools/mcpb exec mcpb "$@"; }

work=$(mktemp -d "${TMPDIR:-/tmp}/mcpb.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/stage/dist"
cp mcpb/manifest.json "$work/stage/manifest.json"
cp dist/mothdex-mcp.mjs "$work/stage/dist/mothdex-mcp.mjs"

mcpb validate "$work/stage/manifest.json"
mcpb pack "$work/stage" "$file"

# The archive holds exactly the manifest and the bundle: no other file, no folder entry, nothing from the repository.
# There is no icon yet (backlog mcpb-icon, after the brand session): `mcpb validate` accepts a manifest without one, so
# this list is honest about it. When the icon lands, add it to the stage above and to this list.
got=$(unzip -Z1 "$file" | sort)
want=$(printf '%s\n' dist/mothdex-mcp.mjs manifest.json)
[ "$got" = "$want" ] || fail "the .mcpb members differ from the expected two:
$(diff <(echo "$want") <(echo "$got") || true)"
# By type too: a symlink or a device in the archive would show up in the unix mode of its entry.
if unzip -Z "$file" | grep -E '^[lbcp]' >/dev/null; then fail "the .mcpb has a member that is not a regular file"; fi

# The members are the committed files, byte for byte, and the packed bundle still starts and answers over stdio.
unzip -p "$file" manifest.json | cmp -s - mcpb/manifest.json || fail "manifest.json in the .mcpb differs from mcpb/manifest.json"
unzip -p "$file" dist/mothdex-mcp.mjs >"$work/packed.mjs"
cmp -s "$work/packed.mjs" dist/mothdex-mcp.mjs || fail "dist/mothdex-mcp.mjs in the .mcpb differs from the committed bundle"
node scripts/smoke-stdio.mjs "$work/packed.mjs"

echo "pack-mcpb: $file sha256 $(sha256sum "$file" | cut -d' ' -f1)"
