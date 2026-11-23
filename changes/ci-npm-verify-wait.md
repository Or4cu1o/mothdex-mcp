### Changed

- The release workflow waits up to about 10 minutes (was 2) for npm to serve a new version before it verifies it, so a slow npm no longer needs a manual re-run of the failed job.
