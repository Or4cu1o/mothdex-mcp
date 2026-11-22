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
# The entries of the fragments go under the first existing "### <Section>" heading of [Unreleased] (a section that has no
# heading there gets a new one, in the order Added, Changed, Deprecated, Removed, Fixed, Security); the rest of
# CHANGELOG.md is not rewritten. Fragments are taken in file name order. POSIX sh and awk only.
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
    -h | --help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# Everything in changes/ is either README.md or a fragment: a plain, non-empty, lower-case .md file that is not a link.
# Anything else (a hidden file, another extension, a folder, a link, an empty file) is refused, never skipped.
files=""
nl='
'
for f in changes/* changes/.[!.]* changes/..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  name=${f#changes/}
  [ "$name" != README.md ] || continue
  case $name in *"$nl"*) die "a file name in changes/ has a newline in it: refused" ;; esac
  printf '%s\n' "$name" | grep -Eq '^[a-z0-9][a-z0-9._-]*[.]md$' ||
    die "$f: a fragment is named like its branch, with only a-z 0-9 . _ - and the extension .md (anything else in changes/ is refused)"
  [ ! -L "$f" ] || die "$f: a fragment cannot be a link"
  [ -f "$f" ] || die "$f: a fragment is a regular file"
  [ -s "$f" ] || die "$f: the fragment is empty"
  files="$files $f"
done

count=0
for f in $files; do count=$((count + 1)); done

work=$(mktemp -d "${TMPDIR:-/tmp}/changelog-fold.XXXXXX")
newlog=""
cleanup() {
  rm -rf "$work"
  if [ -n "$newlog" ]; then rm -f "$newlog"; fi
}
trap cleanup EXIT

# Validates every fragment and writes the entries of each section to $work/<Section>. Exits 1 on the first problem.
if [ "$count" -gt 0 ]; then
  # shellcheck disable=SC2086  # $files holds only names that passed the check above
  awk -v dir="$work" '
    function fail(msg) { print "changelog-fold: " msg > "/dev/stderr"; failed = 1; exit 1 }
    function close_section() {
      if (cur != "") {
        if (!body) fail(prev " has the section " cur " with no entry")
        out[cur] = (out[cur] == "" ? text : out[cur] "\n" text)
      }
      cur = ""; text = ""; pending = ""; body = 0
    }
    { sub(/\r$/, "") }
    BEGIN {
      n = split("Added Changed Deprecated Removed Fixed Security", order, " ")
      for (i = 1; i <= n; i++) known[order[i]] = 1
    }
    FNR == 1 {
      if (NR > 1) { close_section(); if (!sections) fail(prev " has no ### section") }
      prev = FILENAME; sections = 0; cur = ""; text = ""; pending = ""; body = 0
    }
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
      close_section()
      if (!sections) fail(prev " has no ### section")
      for (i = 1; i <= n; i++) {
        if (out[order[i]] == "") continue
        file = dir "/" order[i]
        print out[order[i]] > file
        close(file)
      }
    }
  ' $files || exit 1
fi

if [ "$mode" = check ]; then
  printf 'changelog-fold: %s fragment(s) are well formed\n' "$count"
  exit 0
fi

[ -f CHANGELOG.md ] || die "CHANGELOG.md not found"
[ "$(grep -c '^## \[Unreleased\]' CHANGELOG.md)" -eq 1 ] || die 'CHANGELOG.md needs exactly one "## [Unreleased]" heading'
if [ "$count" -eq 0 ] && [ -z "$release" ]; then
  printf 'changelog-fold: no fragments to fold\n'
  exit 0
fi
if [ -n "$release" ] && awk -v v="## [$release]" 'index($0, v) == 1 { found = 1 } END { exit !found }' CHANGELOG.md; then
  die "CHANGELOG.md already has a section for $release"
fi

# Writes the new CHANGELOG.md next to the old one and replaces it only when the whole run succeeded.
newlog=$(mktemp ./.CHANGELOG.XXXXXX)
awk -v dir="$work" -v release="$release" -v date="$date" '
  BEGIN {
    n = split("Added Changed Deprecated Removed Fixed Security", order, " ")
    for (i = 1; i <= n; i++) {
      file = dir "/" order[i]; txt = ""
      while ((getline line < file) > 0) txt = (txt == "" ? line : txt "\n" line)
      close(file)
      text[order[i]] = txt
      if (txt != "") havetext = 1
    }
  }
  # first pass: which headings does [Unreleased] already have, and does it hold anything
  NR == FNR {
    if ($0 ~ /^## \[Unreleased\]/) { inreg = 1; next }
    if (inreg && $0 ~ /^## \[/) inreg = 0
    if (inreg) {
      if ($0 ~ /[^ \t]/) content = 1
      if ($0 ~ /^### /) { h = substr($0, 5); sub(/[ \t\r]+$/, "", h); exists[h] = 1 }
    }
    next
  }
  FNR == 1 && release != "" && !content && !havetext {
    print "changelog-fold: nothing to release: [Unreleased] is empty and there are no fragments" > "/dev/stderr"
    failed = 1; exit 1
  }
  {
    if ($0 ~ /^## \[Unreleased\]/) {
      print; print ""
      if (release != "") { print "## [" release "] - " date; print "" }
      for (i = 1; i <= n; i++) {
        s = order[i]
        if (text[s] != "" && !(s in exists)) { print "### " s; print ""; print text[s]; print "" }
      }
      inreg = 1; lead = 1
      next
    }
    if (inreg && $0 ~ /^## \[/) inreg = 0
    if (inreg) {
      if (lead && $0 !~ /[^ \t]/) next
      lead = 0
      if ($0 ~ /^### /) {
        h = substr($0, 5); sub(/[ \t\r]+$/, "", h)
        if ((h in text) && text[h] != "" && !(h in merged)) { merged[h] = 1; print $0; print ""; print text[h]; next }
      }
    }
    print
  }
  END { if (failed) exit 1 }
' CHANGELOG.md CHANGELOG.md >"$newlog" || die "could not rewrite CHANGELOG.md; nothing was changed"
chmod 644 "$newlog"
mv "$newlog" CHANGELOG.md
newlog=""

for f in $files; do rm -f -- "$f"; done
printf 'changelog-fold: folded %s fragment(s) into CHANGELOG.md\n' "$count"
if [ -n "$release" ]; then printf 'changelog-fold: [Unreleased] is now [%s] - %s; commit it\n' "$release" "$date"; fi
