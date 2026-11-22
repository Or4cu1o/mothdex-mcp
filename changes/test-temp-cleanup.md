### Fixed

- T-86: the downloader tests remove the temporary folders they create (`mothdex-copy-*`, `mothdex-sig-*`, `mothdex-dst-*`, `mothdex-dl-*`), so a test run no longer leaves hundreds of folders in `/tmp`.
