#!/bin/sh
# Folds the changelog fragments of changes/ into CHANGELOG.md. A pull request adds its own entry as a small file
# (changes/<branch>.md, see changes/README.md) instead of editing CHANGELOG.md, so two open pull requests never conflict
# on that file. Run at release time, by the person preparing the release.
#
#   scripts/changelog-fold.sh                     fold the fragments into the "## [Unreleased]" section, delete them
#   scripts/changelog-fold.sh --release X.Y.Z     the same, then move "[Unreleased]" under "## [X.Y.Z] - <today>"
#                                                 and leave a fresh, empty "[Unreleased]" (--date YYYY-MM-DD to choose)
#   scripts/changelog-fold.sh --check             only validate the fragments (CI); changes nothing
#
# The existing content of CHANGELOG.md is never rewritten: the entries of the fragments are added in front of it, grouped
# by section (Added, Changed, Deprecated, Removed, Fixed, Security) in that order, fragments in file name order.
# POSIX sh and awk only.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."

die() {
  printf 'changelog-fold: %s\n' "$*" >&2
  exit 1
}

mode=apply
release=""
date=""
while [ $# -gt 0 ]; do
  case $1 in
    --check) mode=check; shift ;;
    --release)
      [ $# -ge 2 ] || die "--release needs a version"
      release=$2
      shift 2
      ;;
    --date)
      [ $# -ge 2 ] || die "--date needs YYYY-MM-DD"
      date=$2
      shift 2
      ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

if [ -n "$release" ]; then
  printf '%s\n' "$release" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$' ||
    die "invalid version '$release' (expected X.Y.Z or X.Y.Z-rc.1)"
  [ -n "$date" ] || date=$(date -u +%Y-%m-%d)
  printf '%s\n' "$date" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || die "invalid date '$date' (expected YYYY-MM-DD)"
elif [ -n "$date" ]; then
  die "--date only goes with --release"
fi
if [ "$mode" = check ] && [ -n "$release" ]; then die "--check and --release cannot be used together"; fi

# The fragments: changes/*.md except the README, in name order.
files=""
for f in changes/*.md; do
  [ -f "$f" ] || continue
  name=${f#changes/}
  [ "$name" != README.md ] || continue
  case $name in
    *[!a-z0-9._-]* | .* | -*) die "$f: a fragment name uses only a-z 0-9 . _ - (for example the branch name)" ;;
  esac
  files="$files $f"
done

# Validates every fragment and prints the sections to add, in order. Exits 1 on the first problem.
# shellcheck disable=SC2086  # $files holds only names that passed the check above
generated=$(awk '
  function fail(msg) { print "changelog-fold: " msg > "/dev/stderr"; failed = 1; exit 1 }
  function close_section() {
    if (cur != "" && !body) fail(prev " has the section " cur " with no entry")
    if (cur != "" && text != "") { out[cur] = (out[cur] == "" ? text : out[cur] "\n" text) }
    cur = ""; text = ""; pending = ""; body = 0
  }
  BEGIN {
    n = split("Added Changed Deprecated Removed Fixed Security", order, " ")
    for (i = 1; i <= n; i++) known[order[i]] = 1
  }
  FNR == 1 { if (NR > 1) { close_section(); if (!sections) fail(prev " has no ### section") } prev = FILENAME; sections = 0; cur = ""; text = ""; pending = ""; body = 0 }
  /^### / {
    close_section()
    name = substr($0, 5); sub(/[ \t]+$/, "", name)
    if (!(name in known)) fail(FILENAME " has an unknown section " name " (use Added, Changed, Deprecated, Removed, Fixed or Security)")
    cur = name; sections++
    next
  }
  cur == "" { if ($0 ~ /[^ \t]/) fail(FILENAME " has text before its first ### section"); next }
  {
    if ($0 ~ /[^ \t]/) { text = (text == "" ? $0 : text pending "\n" $0); pending = ""; body = 1 }
    else if (text != "") { pending = pending "\n" }
  }
  END {
    if (failed) exit 1
    if (NR == 0) exit 0
    close_section()
    if (!sections) fail(prev " has no ### section")
    first = 1
    for (i = 1; i <= n; i++) {
      if (out[order[i]] == "") continue
      if (!first) printf "\n"
      first = 0
      printf "### %s\n\n%s\n", order[i], out[order[i]]
    }
  }
' $files) || exit 1

count=0
for f in $files; do count=$((count + 1)); done

if [ "$mode" = check ]; then
  printf 'changelog-fold: %s fragment(s) are well formed\n' "$count"
  exit 0
fi

[ -f CHANGELOG.md ] || die "CHANGELOG.md not found"
[ "$(grep -c '^## \[Unreleased\]' CHANGELOG.md)" -eq 1 ] || die 'CHANGELOG.md needs exactly one "## [Unreleased]" heading'
if [ -z "$generated" ] && [ -z "$release" ]; then
  printf 'changelog-fold: no fragments to fold\n'
  exit 0
fi

line=$(grep -n '^## \[Unreleased\]' CHANGELOG.md | cut -d: -f1)
tmp=$(mktemp "${TMPDIR:-/tmp}/changelog.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  sed -n "1,${line}p" CHANGELOG.md
  printf '\n'
  if [ -n "$release" ]; then printf '## [%s] - %s\n\n' "$release" "$date"; fi
  if [ -n "$generated" ]; then printf '%s\n\n' "$generated"; fi
  sed -n "$((line + 1)),\$p" CHANGELOG.md | awk 'NF { started = 1 } started'
} >"$tmp"
cat "$tmp" >CHANGELOG.md

for f in $files; do rm -f -- "$f"; done
printf 'changelog-fold: folded %s fragment(s) into CHANGELOG.md\n' "$count"
if [ -n "$release" ]; then printf 'changelog-fold: [Unreleased] is now [%s] - %s; commit it\n' "$release" "$date"; fi
