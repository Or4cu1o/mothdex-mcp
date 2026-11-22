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
with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
    version = json.load(f)["version"]
tag = f"v{version}"

with tempfile.TemporaryDirectory(prefix="release-steps.") as work:
    release = os.path.join(work, "release")
    os.makedirs(release)
    # the real tarball of this tree (private: true), and the bundle that is the "attested" release file
    sh(["npm", "pack", "--ignore-scripts", "--pack-destination", release], ROOT)
    tgz = os.path.join(release, f"mothdex-mcp-{version}.tgz")
    mjs = os.path.join(release, f"mothdex-mcp_{version}.mjs")
    shutil.copy(os.path.join(ROOT, "dist", "mothdex-mcp.mjs"), mjs)
    original = os.path.join(work, "original.tgz")
    shutil.copy(tgz, original)
    env = {"TAG": tag, "RUNNER_TEMP": work, "GITHUB_PATH": os.path.join(work, "github_path")}
    TARBALL = "The tarball is what was attested, and is publishable (MP-4)"

    def tarball_case(label, make, expect_ok):
        make(tgz)
        rc, out = run_step(workflow, "npm", TARBALL, work, env)
        good_result = (rc == 0) == expect_ok
        check(good_result, f"tarball check {'passes' if expect_ok else 'refuses'}: {label}" + ("" if good_result else f"\n{out}"))

    tarball_case("the real tarball, private is still true", lambda p: shutil.copy(original, p), False)
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
            # the registry read the re-entrance relies on: this version is not there yet, so the answer is 404 and present=false
            out_file = os.path.join(work, "github_output")
            open(out_file, "w", encoding="utf-8").close()
            rc, out = run_step(workflow, "registry", "Is this version already in the registry?", work, dict(env, GITHUB_OUTPUT=out_file))
            with open(out_file, encoding="utf-8") as f:
                state = f.read().strip()
            check(rc == 0 and state == "present=false", "the registry read says this version is not published yet (HTTP 404)" + ("" if rc == 0 else f"\n{out}"))

if failures:
    sys.exit(f"exercise-release-steps: {len(failures)} check(s) failed")
print("exercise-release-steps: ok")
