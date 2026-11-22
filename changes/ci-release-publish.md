### Added

- T-82 phase B: `release.yml` gets the `npm` job (environment `release`, trusted publishing, no checkout, empty npm config and `registry.npmjs.org` forced, the verified tarball published by path with `--ignore-scripts`,
  integrity, `npm audit signatures` and provenance checked after) and the `registry` job (its own environment `mcp-registry`, no checkout, the pinned `mcp-publisher` verified by SHA-256 and its Sigstore bundle, `server.json`
  generated with `jq` from the verified files, `login github-oidc`). The build job now also packs the npm tarball and attests it with the committed `server.json`. Dormant while `private: true` and until the owner
  configures the environments and the trusted publisher. `scripts/exercise-release-steps.py` exercises the non-publishing steps in CI; `scripts/pack-mcpb.sh` also pins every supply-chain setting and the accepted
  advisories of `tools/mcpb`. The release docs describe it and list the owner settings.
