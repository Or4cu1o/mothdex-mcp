#!/usr/bin/env python3
"""Runs the inline steps of the `npm` and `registry` jobs of .github/workflows/release.yml that do not publish, against files
built from this tree, so a pull request exercises the code that would otherwise first run on a tag (T-82 phase B).

    scripts/exercise-release-steps.py [--with-publisher]

Without --with-publisher nothing touches the network (the local run). With it the pinned mcp-publisher is fetched and
verified by the registry job's own step, and `mcp-publisher validate` runs on the generated server.json (CI).

What is exercised, by extracting the `run:` text of the named steps from the workflow (no copy that could drift):
  - "The tarball is what was attested, and is publishable (MP-4)": must fail on the real tarball (package.json says
    private: true until the release pull request) and on tarballs with a lifecycle script, a dependency, an extra member
    or a changed bundle; must pass on a copy with private: false.
  - "Generate server.json from the verified files (MP-7)": must produce the npm entry plus the mcpb entry with the real
    hash of checksums.txt, and fail on a server.json that is not the npm-only entry for the tag or a missing hash.
  - with --with-publisher: "The pinned mcp-publisher, verified before it runs (MP-8)" and `mcp-publisher validate`.
Nothing here publishes, signs or logs in.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

try:
    import yaml
except ImportError:  # the runner image or the developer machine lacks PyYAML: say so, never skip
    sys.exit("exercise-release-steps: PyYAML is required (python3 -m pip install pyyaml)")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "release.yml")
with_publisher = "--with-publisher" in sys.argv[1:]
failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def load_workflow():
    with open(WORKFLOW, encoding="utf-8") as f:
        return yaml.safe_load(f)


def step(workflow, job, name):
    for s in workflow["jobs"][job]["steps"]:
        if s.get("name") == name:
            return s
    sys.exit(f"exercise-release-steps: no step named {name!r} in job {job!r}")


def run_step(workflow, job, name, cwd, env_extra):
    """Runs the step's script like the runner does (bash -e -o pipefail) and returns (returncode, output)."""
    script = step(workflow, job, name)["run"]
    env = dict(os.environ)
    for k, v in (workflow["jobs"][job].get("env") or {}).items():
        env[k] = str(v)
    env.update(env_extra)
    proc = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], cwd=cwd, env=env, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def sh(args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)


def repack(tgz, out, mutate):
    """Unpacks a tarball, lets `mutate(dir)` change it and packs it again (GNU tar, sorted, plain owner)."""
    with tempfile.TemporaryDirectory() as tmp:
        sh(["tar", "-xzf", tgz, "-C", tmp], tmp)
        mutate(tmp)
        # files only, like npm's own tarball: no directory entries
        files = sorted(os.path.join(d, f) for d, _, names in os.walk(os.path.join(tmp, "package")) for f in names)
        listing = os.path.join(tmp, "files.list")
        with open(listing, "w", encoding="utf-8") as f:
            f.write("\n".join(os.path.relpath(p, tmp) for p in files) + "\n")
        sh(["tar", "--owner=0", "--group=0", "--numeric-owner", "--no-recursion", "-czf", out, "-C", tmp, "-T", listing], tmp)


def edit_package_json(**changes):
    def mutate(tmp):
        path = os.path.join(tmp, "package", "package.json")
        with open(path, encoding="utf-8") as f:
            pj = json.load(f)
        for k, v in changes.items():
            if v is None:
                pj.pop(k, None)
            else:
                pj[k] = v
        with open(path, "w", encoding="utf-8") as f:
            json.dump(pj, f)

    return mutate


workflow = load_workflow()

# QA: the structure the threat model fixes (MP-1, MP-2, MP-3, MP-9, MP-6): environments, permissions, no checkout, no secret.
STRUCTURE = {
    "npm": {"environment": "release", "permissions": {"contents": "read", "attestations": "read", "id-token": "write"}},
    "registry": {"environment": "mcp-registry", "permissions": {"contents": "read", "attestations": "read", "id-token": "write"}},
}
for job_name, want in STRUCTURE.items():
    job = workflow["jobs"][job_name]
    check(job.get("environment") == want["environment"], f"job {job_name} runs in environment {want['environment']}")
    check(job.get("permissions") == want["permissions"], f"job {job_name} has exactly the permissions {want['permissions']}")
    uses = [x.get("uses", "") for x in job["steps"]]
    check(not any(u.startswith("actions/checkout") for u in uses), f"job {job_name} has no checkout")
    check(all(("@" in u and len(u.split("@")[1].split()[0]) == 40) for u in uses if u), f"job {job_name}: every action is pinned by a full SHA")
    token_envs = [k for x in job["steps"] for k in (x.get("env") or {}) if k in ("NODE_AUTH_TOKEN", "NPM_TOKEN")]
    check("secrets." not in json.dumps(job) and not token_envs, f"job {job_name} reads no secret and sets no npm token")
check(workflow["jobs"]["npm"]["needs"] == ["build", "attest", "publish"], "npm needs build, attest and publish")
check(workflow["jobs"]["registry"]["needs"] == ["build", "attest", "publish", "npm"], "registry needs the npm job too")
check(workflow["jobs"]["npm"]["environment"] != workflow["jobs"]["registry"]["environment"], "the two publishing jobs use different environments")
node_step = next(x for x in workflow["jobs"]["npm"]["steps"] if str(x.get("uses", "")).startswith("actions/setup-node"))
check(str(node_step["with"]["node-version"]) == "26.13.1", "the npm job pins Node 26.13.1")
# QA and Crivo: a pre-release tag skips both publishing jobs; the verification block of the two jobs is the same text; the publish
# steps carry the exact flags and no retry or loop; the npm pin steps behave (run below).
for job_name in ("npm", "registry"):
    check("github.ref_name" in str(workflow["jobs"][job_name].get("if", "")) and "'-'" in str(workflow["jobs"][job_name].get("if", "")),
          f"job {job_name} is skipped for a pre-release tag")
VERIFY = "Verify checksums, attestations and the tag before any token is used"
check(step(workflow, "npm", VERIFY)["run"] == step(workflow, "registry", VERIFY)["run"], "the verification step is the same text in the npm and registry jobs")
for job_name, step_name in (("npm", "Publish the verified tarball (no repack, no retry)"), ("registry", "Log in with GitHub OIDC and publish (no retry)")):
    code = "\n".join(line for line in step(workflow, job_name, step_name)["run"].splitlines() if not line.lstrip().startswith("#"))
    check(re.search(r"(^|[\s;|&(])(for|while|until)\s", code) is None and not any(w in code for w in ("retry", "sleep ")),
          f"{job_name} publish step has no loop or retry")
npm_publish = step(workflow, "npm", "Publish the verified tarball (no repack, no retry)")["run"]
check('npm publish "./release/$name" --provenance --access public --ignore-scripts --registry https://registry.npmjs.org/' in npm_publish,
      "the npm publish line has the exact flags (by path, provenance, public, no scripts, forced registry)")
check("npm pack" not in json.dumps(workflow["jobs"]["npm"]) and "npm publish ." not in npm_publish, "the npm job never packs and never publishes a directory")
with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
    version = json.load(f)["version"]
tag = f"v{version}"

with tempfile.TemporaryDirectory(prefix="release-steps.") as work:
    release = os.path.join(work, "release")
    os.makedirs(release)
    # the real tarball of this tree, and the bundle that is the "attested" release file
    sh(["npm", "pack", "--ignore-scripts", "--pack-destination", release], ROOT)
    tgz = os.path.join(release, f"mothdex-mcp-{version}.tgz")
    mjs = os.path.join(release, f"mothdex-mcp_{version}.mjs")
    shutil.copy(os.path.join(ROOT, "dist", "mothdex-mcp.mjs"), mjs)
    # the cases below start from a tarball with private: true whatever this tree has (true before the release PR, false in it)
    original = os.path.join(work, "original.tgz")
    repack(tgz, original, edit_package_json(private=True))
    env = {"TAG": tag, "RUNNER_TEMP": work, "GITHUB_PATH": os.path.join(work, "github_path")}
    TARBALL = "The tarball is what was attested, and is publishable (MP-4)"

    def tarball_case(label, make, expect_ok):
        make(tgz)
        rc, out = run_step(workflow, "npm", TARBALL, work, env)
        good_result = (rc == 0) == expect_ok
        check(good_result, f"tarball check {'passes' if expect_ok else 'refuses'}: {label}" + ("" if good_result else f"\n{out}"))

    tarball_case("the tarball with private still true", lambda p: shutil.copy(original, p), False)
    good = os.path.join(work, "good.tgz")
    repack(original, good, edit_package_json(private=False))
    tarball_case("private false", lambda p: shutil.copy(good, p), True)

    def variant(label, mutate):
        out = os.path.join(work, "variant.tgz")
        repack(good, out, mutate)
        tarball_case(label, lambda p: shutil.copy(out, p), False)

    variant("a postinstall script", edit_package_json(scripts={"postinstall": "node -e 0"}))
    variant("a dependency", edit_package_json(dependencies={"left-pad": "1.3.0"}))
    variant("another version than the tag", edit_package_json(version="9.9.9"))
    variant("another mcpName", edit_package_json(mcpName="io.github.someone/else"))

    def add_member(tmp):
        with open(os.path.join(tmp, "package", "extra.js"), "w", encoding="utf-8") as f:
            f.write("x")

    variant("an extra member", add_member)
    # QA: every rule of the jq filter and of the member checks gets a case of its own
    variant("another package name", edit_package_json(name="mothdex-mcp-other"))
    variant("another bin", edit_package_json(bin={"mothdex-mcp": "dist/other.mjs"}))
    variant("an optional dependency", edit_package_json(optionalDependencies={"left-pad": "1.3.0"}))
    variant("a peer dependency", edit_package_json(peerDependencies={"left-pad": "1.3.0"}))
    variant("bundled dependencies", edit_package_json(bundleDependencies=["left-pad"]))
    variant("a prepare script", edit_package_json(scripts={"prepare": "node -e 0"}))
    variant("a prepublishOnly script", edit_package_json(scripts={"prepublishOnly": "node -e 0"}))
    variant("an install script", edit_package_json(scripts={"install": "node -e 0"}))
    variant("no provenance in publishConfig", edit_package_json(publishConfig={"access": "public"}))
    variant("a restricted access in publishConfig", edit_package_json(publishConfig={"access": "restricted", "provenance": True}))

    def link_license(tmp):  # an allowed name, but a link: only the check by type can see it
        path = os.path.join(tmp, "package", "LICENSE")
        os.remove(path)
        os.symlink("/etc/passwd", path)

    variant("an allowed member that is a symbolic link", link_license)

    def drop_license(tmp):
        os.remove(os.path.join(tmp, "package", "LICENSE"))

    variant("a missing LICENSE", drop_license)

    def change_bundle(tmp):
        with open(os.path.join(tmp, "package", "dist", "mothdex-mcp.mjs"), "a", encoding="utf-8") as f:
            f.write("\n// changed\n")

    variant("a bundle that is not the attested file", change_bundle)

    # --- server.json for the registry
    shutil.copy(good, tgz)
    shutil.copy(os.path.join(ROOT, "server.json"), os.path.join(release, "server.json"))
    mcpb_sha = "a" * 64
    with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
        f.write(f"{mcpb_sha}  mothdex-mcp_{version}.mcpb\n")
    GENERATE = "Generate server.json from the verified files (MP-7)"
    rc, out = run_step(workflow, "registry", GENERATE, work, env)
    generated = os.path.join(work, "server.generated.json")
    check(rc == 0 and os.path.exists(generated), "server.json is generated" + ("" if rc == 0 else f"\n{out}"))
    if rc == 0 and os.path.exists(generated):
        with open(generated, encoding="utf-8") as f:
            sj = json.load(f)
        kinds = [p["registryType"] for p in sj["packages"]]
        mcpb = sj["packages"][1] if len(sj["packages"]) == 2 else {}
        check(kinds == ["npm", "mcpb"], "the generated server.json has the npm and the mcpb entries")
        check(
            mcpb.get("fileSha256") == mcpb_sha
            and mcpb.get("identifier") == f"https://github.com/Or4cu1o/mothdex-mcp/releases/download/{tag}/mothdex-mcp_{version}.mcpb",
            "the mcpb entry carries the hash of checksums.txt and the release URL of the tag",
        )
        check(
            mcpb.get("environmentVariables") == sj["packages"][0].get("environmentVariables"),
            "the mcpb entry has the same environment variables as the npm one",
        )
    # QA: each rule of the server.json filter gets a case; the committed file is changed one field at a time
    with open(os.path.join(ROOT, "server.json"), encoding="utf-8") as f:
        committed = json.load(f)
    with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
        f.write(f"{mcpb_sha}  mothdex-mcp_{version}.mcpb\n")

    def server_case(label, change):
        sj2 = json.loads(json.dumps(committed))
        change(sj2)
        with open(os.path.join(release, "server.json"), "w", encoding="utf-8") as f:
            json.dump(sj2, f)
        rc2, _ = run_step(workflow, "registry", GENERATE, work, env)
        check(rc2 != 0, f"server.json refused: {label}")

    server_case("a name that is not the package's mcpName", lambda d: d.update(name="io.github.someone/else"))
    server_case("a version that is not the tag's", lambda d: d.update(version="9.9.9"))
    server_case("an npm version that is not the tag's", lambda d: d["packages"][0].update(version="9.9.9"))
    server_case("another npm package name", lambda d: d["packages"][0].update(identifier="another-package"))
    server_case("another repository", lambda d: d["repository"].update(url="https://github.com/someone/else"))
    # a server.json that is not the npm-only entry must be refused
    with open(os.path.join(ROOT, "server.json"), encoding="utf-8") as f:
        base = json.load(f)
    base["packages"].append(dict(base["packages"][0]))
    with open(os.path.join(release, "server.json"), "w", encoding="utf-8") as f:
        json.dump(base, f)
    rc, _ = run_step(workflow, "registry", GENERATE, work, env)
    check(rc != 0, "a server.json that already has two entries is refused")
    shutil.copy(os.path.join(ROOT, "server.json"), os.path.join(release, "server.json"))
    with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
        f.write(f"not-a-hash  mothdex-mcp_{version}.mcpb\n")
    rc, _ = run_step(workflow, "registry", GENERATE, work, env)
    check(rc != 0, "a checksums.txt line that is not 64 hex characters is refused")

    # a tag that is not a semantic version never reaches the generated file (QA S2)
    shutil.copy(os.path.join(ROOT, "server.json"), os.path.join(release, "server.json"))
    with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
        f.write(f"{mcpb_sha}  mothdex-mcp_{version}.mcpb\n")
    for bad_tag in ("vfoo", "v1.2", "v1.2.3;touch-x", "v1.2.3 ", "v1.2.3/../x"):
        rc, _ = run_step(workflow, "registry", GENERATE, work, dict(env, TAG=bad_tag))
        check(rc != 0, f"the generate step refuses the tag {bad_tag!r}")

    # the npm configuration pins: the step writes two different empty files and the registry; the check refuses anything else
    github_env = os.path.join(work, "github_env")
    open(github_env, "w", encoding="utf-8").close()
    rc, out = run_step(workflow, "npm", "Pin the npm configuration", work, dict(env, GITHUB_ENV=github_env))
    pinned = dict(line.split("=", 1) for line in open(github_env, encoding="utf-8").read().split("\n") if "=" in line)
    check(rc == 0 and pinned.get("NPM_CONFIG_USERCONFIG") != pinned.get("NPM_CONFIG_GLOBALCONFIG") and pinned.get("NPM_CONFIG_REGISTRY") == "https://registry.npmjs.org/",
          "the npm pin step writes two different config files and the registry" + ("" if rc == 0 else f"\n{out}"))
    if rc == 0:
        base_env = {k: v for k, v in os.environ.items() if not k.lower().startswith("npm_config_") and k not in ("NODE_AUTH_TOKEN", "NPM_TOKEN")}
        pinned_env = dict(base_env, **pinned, TAG=tag)
        CLEAN = "No other npm configuration is in effect"

        def clean(label, extra, expect_ok):
            script = step(workflow, "npm", CLEAN)["run"]
            proc = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], cwd=work, env=dict(pinned_env, **extra), capture_output=True, text=True)
            ok = (proc.returncode == 0) == expect_ok
            check(ok, f"npm configuration check {'passes' if expect_ok else 'refuses'}: {label}" + ("" if ok else f"\n{proc.stdout}{proc.stderr}"))

        clean("only the pinned configuration", {}, True)
        clean("another npm_config variable", {"NPM_CONFIG_PREFIX": "/tmp/x"}, False)
        clean("a lower-case npm_config variable", {"npm_config_cache": "/tmp/x"}, False)
        clean("another registry", {"NPM_CONFIG_REGISTRY": "https://evil.example/"}, False)
        clean("a NODE_AUTH_TOKEN", {"NODE_AUTH_TOKEN": "x"}, False)
        clean("an NPM_TOKEN", {"NPM_TOKEN": "x"}, False)

    # package.json private: true is the default; false only when CHANGELOG.md has the section of this version (QA, Crivo)
    def private_case(label, private, changelog_heading, expect_ok, notices=None):
        tree = os.path.join(work, "tree")
        if os.path.exists(tree):
            shutil.rmtree(tree)
        for rel in ("package.json", "server.json", "README.md", "LICENSE", os.path.join("mcpb", "manifest.json"), os.path.join("mcpb", "icon.png"), os.path.join("dist", "mothdex-mcp.mjs"), os.path.join("dist", "THIRD_PARTY_NOTICES.txt"), os.path.join("scripts", "check-icon.mjs"), os.path.join("scripts", "check-icon.mjs"),
                    os.path.join("scripts", "check-package.mjs")):
            os.makedirs(os.path.dirname(os.path.join(tree, rel)), exist_ok=True)
            shutil.copy(os.path.join(ROOT, rel), os.path.join(tree, rel))
        if notices is not None:
            with open(os.path.join(tree, "dist", "THIRD_PARTY_NOTICES.txt"), "w", encoding="utf-8") as f:
                f.write(notices)
        with open(os.path.join(tree, "package.json"), encoding="utf-8") as f:
            pj = json.load(f)
        pj["private"] = private
        with open(os.path.join(tree, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pj, f)
        with open(os.path.join(tree, "CHANGELOG.md"), "w", encoding="utf-8") as f:
            f.write("# Changelog\n\n## [Unreleased]\n" + (f"\n## [{version}] - 2026-12-01\n" if changelog_heading else ""))
        proc = subprocess.run(["node", os.path.join(tree, "scripts", "check-package.mjs")], cwd=tree, capture_output=True, text=True)
        ok = (proc.returncode == 0) == expect_ok
        check(ok, f"check-package {'accepts' if expect_ok else 'refuses'}: {label}" + ("" if ok else f"\n{proc.stdout}{proc.stderr}"))

    # the icon check: a complete 512x512 PNG passes; a missing, truncated, wrong-chunk or wrong-size file fails with a message
    with open(os.path.join(ROOT, "mcpb", "icon.png"), "rb") as f:
        icon_good = f.read()

    def icon_case(label, data, expect_ok):
        path = os.path.join(work, "icon-case.png")
        if data is None:
            if os.path.exists(path):
                os.remove(path)
        else:
            with open(path, "wb") as f:
                f.write(data)
        proc = subprocess.run(["node", os.path.join(ROOT, "scripts", "check-icon.mjs"), path], capture_output=True, text=True)
        ok = (proc.returncode == 0) == expect_ok and "Error:" not in proc.stderr and "    at " not in proc.stderr
        check(ok, f"icon check {'accepts' if expect_ok else 'refuses'}: {label}" + ("" if ok else f"\n{proc.stdout}{proc.stderr}"))

    icon_case("the committed icon", icon_good, True)
    icon_case("a missing file (readable message, no stack trace)", None, False)
    icon_case("a truncated file", icon_good[:-1], False)
    icon_case("a file cut before IEND", icon_good[:-12], False)
    icon_case("a file that is not a PNG", b"GIF89a" + icon_good[6:], False)
    icon_case("a PNG whose first chunk is not IHDR", icon_good[:12] + b"IDAT" + icon_good[16:], False)
    icon_case("a PNG of another size", icon_good[:16] + (256).to_bytes(4, "big") + icon_good[20:], False)
    icon_case("a PNG of the right width and height 256", icon_good[:20] + (256).to_bytes(4, "big") + icon_good[24:], False)
    icon_case("a file shorter than 24 bytes (readable message, no stack trace)", icon_good[:23], False)

    private_case("private true", True, False, True)
    private_case("private false with the version in the changelog (the release PR)", False, True, True)
    private_case("private false without the version in the changelog", False, False, False)
    private_case("private as the text 'false', with the version in the changelog", "false", True, False)
    # every inlined package needs its licence in dist/THIRD_PARTY_NOTICES.txt
    notices_text = open(os.path.join(ROOT, "dist", "THIRD_PARTY_NOTICES.txt"), encoding="utf-8").read()
    zod_start = notices_text.index("\n" + "=" * 78 + "\nzod@")
    private_case("a notices file without the licence of zod", True, False, False, notices=notices_text[:zod_start + 1])
    private_case("an empty notices file", True, False, False, notices="")

    # QA: the npm publish guard and the registry re-entry, run with fake `npm` and `curl` programs first on PATH. The real
    # programs are never called, so nothing here touches the network or a registry, and the result does not depend on whether
    # this version has been published since.
    shims = os.path.join(work, "shims")
    os.makedirs(shims)

    def write_shim(name, body):
        path = os.path.join(shims, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write("#!/bin/bash\n" + body)
        os.chmod(path, 0o755)

    write_shim("npm", 'echo "npm $*" >> "$FAKE_LOG"\ncase "$1" in view) printf "%s" "${FAKE_NPM_VIEW-}"; printf "%s" "${FAKE_NPM_VIEW_ERR-}" >&2; exit "${FAKE_NPM_VIEW_RC:-0}" ;; esac\nexit 0\n')
    write_shim("curl", 'echo "curl $*" >> "$FAKE_LOG"\nout=""; while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; esac; shift; done\n'
               '[ -n "$out" ] && printf "%s" "${FAKE_CURL_BODY-}" > "$out"; printf "%s" "${FAKE_CURL_CODE:-000}"\n')
    PUBLISH = "Publish the verified tarball (no repack, no retry)"
    pubdir = os.path.join(work, "pubwork")
    os.makedirs(os.path.join(pubdir, "release"))
    pub_tgz = os.path.join(pubdir, "release", f"mothdex-mcp-{version}.tgz")

    def publish_case(label, view_out, view_rc, expect_rc_ok, expect_publish, tamper=False, view_err=""):
        shutil.copy(good, pub_tgz)
        with open(os.path.join(pubdir, "release", "checksums.txt"), "w", encoding="utf-8") as f:
            f.write(subprocess.run(["sha256sum", os.path.basename(pub_tgz)], cwd=os.path.dirname(pub_tgz), capture_output=True, text=True).stdout)
        if tamper:
            with open(pub_tgz, "ab") as f:
                f.write(b"x")
        log = os.path.join(work, "fake.log")
        open(log, "w", encoding="utf-8").close()
        penv = dict(env, PATH=shims + os.pathsep + os.environ["PATH"], FAKE_LOG=log, FAKE_NPM_VIEW=view_out, FAKE_NPM_VIEW_ERR=view_err, FAKE_NPM_VIEW_RC=str(view_rc))
        rc3, out3 = run_step(workflow, "npm", PUBLISH, pubdir, penv)
        calls = open(log, encoding="utf-8").read().splitlines()
        published = [c for c in calls if c.startswith("npm publish")]
        ok = ((rc3 == 0) == expect_rc_ok) and (len(published) == (1 if expect_publish else 0))
        if expect_publish and published:
            ok = ok and published[0] == f"npm publish ./release/mothdex-mcp-{version}.tgz --provenance --access public --ignore-scripts --registry https://registry.npmjs.org/"
        check(ok, f"npm publish guard: {label}" + ("" if ok else f"\n{out3}\n{calls}"))

    publish_case("the version is already on npm: nothing is published", version, 0, True, False)
    publish_case("not on npm (empty answer): published once with the exact flags", "", 0, True, True)
    publish_case("not on npm (empty answer, failing status): published once", "", 1, True, True)
    publish_case("not on npm (E404): published once", "npm error code E404\nnpm error 404 Not Found", 1, True, True)
    publish_case("another error (E401): stopped, nothing published", "npm error code E401", 1, False, False)
    publish_case("another version in the answer: stopped, nothing published", "0.0.9", 0, False, False)
    publish_case("the tarball changed after verification: stopped before npm is asked", "", 0, False, False, tamper=True)
    # the stderr branch (Crivo S1): stdout alone says the version exists, stderr alone tells "not found" from a real error
    NOTICE = "npm notice New major version of npm available! 10.0.0 -> 99.0.0\n"
    publish_case("E404 only on stderr: published once", "", 1, True, True, view_err="npm error code E404\nnpm error 404 Not Found\n")
    publish_case("E404 on stderr after a notice: published once", "", 1, True, True, view_err=NOTICE + "npm error code E404\n")
    publish_case("a network error only on stderr: stopped, nothing published", "", 1, False, False, view_err="npm error code ENOTFOUND\nnpm error network request failed\n")
    publish_case("E401 only on stderr: stopped, nothing published", "", 1, False, False, view_err="npm error code E401\nnpm error Unable to authenticate\n")
    publish_case("E403 only on stderr: stopped, nothing published", "", 1, False, False, view_err="npm error code E403\n")
    publish_case("the version on stdout and a notice on stderr: already published, nothing published", version, 0, True, False, view_err=NOTICE)
    publish_case("the version on stdout, a failing status and an error on stderr: already published", version, 1, True, False, view_err="npm error code E500\n")
    publish_case("empty stdout and only an npm notice on stderr: published once", "", 0, True, True, view_err=NOTICE)
    publish_case("empty stdout and an npm warning on stderr: published once", "", 0, True, True, view_err="npm warn config something deprecated\n")
    publish_case("another version on stdout and a notice on stderr: stopped, nothing published", "0.0.9", 0, False, False, view_err=NOTICE)
    publish_case("old-style npm ERR! on stderr with empty stdout: stopped, nothing published", "", 1, False, False, view_err="npm ERR! code ENOTFOUND\nnpm ERR! network request failed\n")
    publish_case("the version with a suffix on stdout: not taken as published, stopped", f"{version}-rc.1", 0, False, False)
    publish_case("the version with a suffix on stdout and a notice on stderr: stopped", f"{version}-rc.1", 0, False, False, view_err=NOTICE)

    # the registry read: a state step that never sends the version twice and never overwrites a different .mcpb
    shutil.copy(os.path.join(ROOT, "server.json"), os.path.join(release, "server.json"))
    with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
        f.write(f"{mcpb_sha}  mothdex-mcp_{version}.mcpb\n")
    rcg, _ = run_step(workflow, "registry", GENERATE, work, env)
    STATE = "Is this version already in the registry?"

    def state_case(label, code, body, expect_ok, expect_state):
        out_file = os.path.join(work, "github_output")
        open(out_file, "w", encoding="utf-8").close()
        log = os.path.join(work, "fake.log")
        open(log, "w", encoding="utf-8").close()
        senv = dict(env, PATH=shims + os.pathsep + os.environ["PATH"], FAKE_LOG=log, FAKE_CURL_CODE=code, FAKE_CURL_BODY=body, GITHUB_OUTPUT=out_file)
        rc4, out4 = run_step(workflow, "registry", STATE, work, senv)
        state_out = open(out_file, encoding="utf-8").read().strip()
        ok = ((rc4 == 0) == expect_ok) and state_out == expect_state
        check(ok, f"registry re-entry: {label}" + ("" if ok else f"\n{out4}\n{state_out!r}"))

    same = json.dumps({"server": {"packages": [{"registryType": "npm"}, {"registryType": "mcpb", "fileSha256": mcpb_sha}]}})
    other = json.dumps({"server": {"packages": [{"registryType": "npm"}, {"registryType": "mcpb", "fileSha256": "b" * 64}]}})
    nombcp = json.dumps({"server": {"packages": [{"registryType": "npm"}]}})
    check(rcg == 0, "the generated server.json for the registry cases exists")
    state_case("404: not published yet, present=false", "404", "", True, "present=false")
    state_case("200 with the same .mcpb hash: present=true, nothing to send", "200", same, True, "present=true")
    state_case("200 with another .mcpb hash: stopped", "200", other, False, "")
    state_case("200 without an mcpb package: stopped", "200", nombcp, False, "")
    state_case("200 with an unreadable body: stopped", "200", "not json", False, "")
    state_case("HTTP 500: stopped", "500", "", False, "")
    state_case("HTTP 403: stopped", "403", "", False, "")
    # the name has a slash, so the URL must carry it encoded, and the version of the tag
    state_case("the request goes to the encoded name and the tag's version", "404", "", True, "present=false")
    asked = [c for c in open(os.path.join(work, "fake.log"), encoding="utf-8").read().splitlines() if c.startswith("curl ")]
    check(len(asked) == 1 and asked[0].endswith(f"https://registry.modelcontextprotocol.io/v0/servers/io.github.Or4cu1o%2Fmothdex-mcp/versions/{version}"),
          "the registry read asks https://registry.modelcontextprotocol.io/v0/servers/<name, url-encoded>/versions/<version> once" + ("" if len(asked) == 1 else f"\n{asked}"))
    publish_state = step(workflow, "registry", "Log in with GitHub OIDC and publish (no retry)")
    check(publish_state.get("if") == "steps.state.outputs.present != 'true'", "the registry login and publish step runs only when the version is not there")

    if with_publisher:
        with open(os.path.join(release, "checksums.txt"), "w", encoding="utf-8") as f:
            f.write(f"{mcpb_sha}  mothdex-mcp_{version}.mcpb\n")
        run_step(workflow, "registry", GENERATE, work, env)
        rc, out = run_step(workflow, "registry", "The pinned mcp-publisher, verified before it runs (MP-8)", work, env)
        check(rc == 0, "the pinned mcp-publisher downloads and verifies (hash and Sigstore bundle)" + ("" if rc == 0 else f"\n{out}"))
        if rc == 0:
            with open(env["GITHUB_PATH"], encoding="utf-8") as f:
                bindir = f.read().strip()
            proc = subprocess.run([os.path.join(bindir, "mcp-publisher"), "validate", generated], cwd=work, capture_output=True, text=True)
            check(
                proc.returncode == 0,
                "mcp-publisher validate accepts the generated server.json" + ("" if proc.returncode == 0 else f"\n{proc.stdout}{proc.stderr}"),
            )

if failures:
    sys.exit(f"exercise-release-steps: {len(failures)} check(s) failed")
print("exercise-release-steps: ok")
