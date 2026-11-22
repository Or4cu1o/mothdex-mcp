#!/usr/bin/env bash
# Packs the .mcpb (MCP Bundle) of the committed bundle with the pinned mcpb CLI of tools/mcpb, and checks the result.
# Used by the release build and by CI on every pull request, so the first tag does not meet it for the first time.
#
#   scripts/pack-mcpb.sh <out-dir>      writes <out-dir>/mothdex-mcp_<version>.mcpb (the version of package.json);
#                                       a relative <out-dir> is relative to the repository root, not to the caller
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

# The tool is the one the repository pins: the installed version equals the exact devDependencies value, and the only pnpm
# trust exception of tools/mcpb is the reviewed undici-types@6.21.0 (nothing else may be added without this check failing).
installed=$(node -p "require('./tools/mcpb/node_modules/@anthropic-ai/mcpb/package.json').version")
pinned=$(node -p "require('./tools/mcpb/package.json').devDependencies['@anthropic-ai/mcpb']")
[ "$installed" = "$pinned" ] || fail "the installed mcpb is $installed, tools/mcpb/package.json pins $pinned"
excluded=$(awk '/^trustPolicyExclude:/ { f = 1; next } f && /^[[:space:]]+-[[:space:]]/ { sub(/^[[:space:]]+-[[:space:]]+/, ""); print; next } f { exit }' tools/mcpb/pnpm-workspace.yaml)
[ "$excluded" = "undici-types@6.21.0" ] || fail "trustPolicyExclude in tools/mcpb/pnpm-workspace.yaml is not exactly undici-types@6.21.0: $excluded"
# every supply-chain setting of the root is repeated, with the same value, in tools/mcpb (nothing weaker there)
for key in engineStrict strictDepBuilds minimumReleaseAge blockExoticSubdeps trustPolicy; do
  root_line=$(grep -E "^${key}:" pnpm-workspace.yaml || true)
  tool_line=$(grep -E "^${key}:" tools/mcpb/pnpm-workspace.yaml || true)
  if [ -z "$root_line" ] || [ "$root_line" != "$tool_line" ]; then fail "tools/mcpb/pnpm-workspace.yaml must have '$root_line' like the root (it has '$tool_line')"; fi
done
# the accepted advisories are exactly these three, each reviewed (reasons in tools/mcpb/pnpm-workspace.yaml)
ignored=$(awk '/^[[:space:]]+ignoreGhsas:/ { f = 1; next } f && /^[[:space:]]*#/ { next } f && /^[[:space:]]+-[[:space:]]/ { sub(/^[[:space:]]+-[[:space:]]+/, ""); print; next } f { exit }' tools/mcpb/pnpm-workspace.yaml | sort | tr '\n' ' ')
[ "$ignored" = "GHSA-52f5-9888-hmc6 GHSA-mrhx-c7xc-m3w5 GHSA-ph9p-34f9-6g65 " ] || fail "ignoreGhsas in tools/mcpb/pnpm-workspace.yaml is not exactly the three reviewed advisories: $ignored"

# `pnpm --dir tools/mcpb exec` runs in tools/mcpb, so every path given to it is absolute.
mcpb() { pnpm --dir tools/mcpb exec mcpb "$@"; }

work=$(mktemp -d "${TMPDIR:-/tmp}/mcpb.XXXXXX")
trap 'rm -rf "$work"' EXIT
# The icon is the committed PNG (project-owned art approved in D30), 512x512, referenced by manifest.json as "icon.png".
node -e '
  const b = require("node:fs").readFileSync("mcpb/icon.png");
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!png || b.readUInt32BE(16) !== 512 || b.readUInt32BE(20) !== 512) { console.error("mcpb/icon.png must be a 512x512 PNG"); process.exit(1); }
' || fail "mcpb/icon.png is not a 512x512 PNG"
[ "$(node -p "require('./mcpb/manifest.json').icon")" = "icon.png" ] || fail "mcpb/manifest.json must reference the icon as icon.png"
mkdir -p "$work/stage/dist"
cp mcpb/manifest.json "$work/stage/manifest.json"
cp mcpb/icon.png "$work/stage/icon.png"
cp dist/mothdex-mcp.mjs "$work/stage/dist/mothdex-mcp.mjs"

mcpb validate "$work/stage/manifest.json"
mcpb pack "$work/stage" "$file"

# The archive holds exactly the manifest, the icon and the bundle: no other file, no folder entry, nothing from the repository.
got=$(unzip -Z1 "$file" | sort)
want=$(printf '%s\n' dist/mothdex-mcp.mjs icon.png manifest.json)
[ "$got" = "$want" ] || fail "the .mcpb members differ from the expected three:
$(diff <(echo "$want") <(echo "$got") || true)"
# By type too: a symlink or a device in the archive would show up in the unix mode of its entry.
if unzip -Z "$file" | grep -E '^[lbcp]' >/dev/null; then fail "the .mcpb has a member that is not a regular file"; fi

# The members are the committed files, byte for byte, and the packed bundle still starts and answers over stdio.
unzip -p "$file" manifest.json | cmp -s - mcpb/manifest.json || fail "manifest.json in the .mcpb differs from mcpb/manifest.json"
unzip -p "$file" icon.png | cmp -s - mcpb/icon.png || fail "icon.png in the .mcpb differs from mcpb/icon.png"
unzip -p "$file" dist/mothdex-mcp.mjs >"$work/packed.mjs"
cmp -s "$work/packed.mjs" dist/mothdex-mcp.mjs || fail "dist/mothdex-mcp.mjs in the .mcpb differs from the committed bundle"
node scripts/smoke-stdio.mjs "$work/packed.mjs"

echo "pack-mcpb: $file sha256 $(sha256sum "$file" | cut -d' ' -f1)"
