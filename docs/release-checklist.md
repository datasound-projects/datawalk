# Release checklist

Do these steps in this order for each release. Stop when a step fails.

## 1. Code and tests

1. Make sure that `main` has no open blocking issues.
2. Run all checks (see [CONTRIBUTING.md](../CONTRIBUTING.md#checks)). All must pass:
   ruff, pytest (library and hub), ESLint, TypeScript, Vitest, and the complete Playwright
   suite (Chromium, Firefox, WebKit projects).
3. Run `datawalk doctor` on a clean machine. Every required check must be "ok".

## 2. Dependencies and licenses

1. Update the dependency licenses table in [architecture.md](architecture.md).
2. Run `npm audit` in `apps/web`. Resolve every high or critical finding.
3. Confirm that every new asset in `assets/manifest.json` is CC0 and has its hashes.
4. Regenerate [credits.md](credits.md) when assets changed.

## 3. Measurements

1. Run `node apps/web/scripts/perf.mjs --headed` on the reference machines. Commit
   `docs/performance.md`.
2. Export the demo (`--html --site --pdf --pptx --glb --usdz`). Update the size table in
   [exports.md](exports.md).
3. Open the single HTML export from disk in the latest two versions of Chrome, Edge, Firefox,
   and Safari, without network. Enter a room and inspect a chart.
4. Open the PPTX in PowerPoint, the GLB in Blender, and the USDZ in Quick Look.

## 4. Version and build

1. Set the version in `pyproject.toml`, `packages/python/datawalk/__init__.py`,
   `packages/hub/pyproject.toml`, and `apps/web/package.json`.
2. If the report model changed: increase `SCHEMA_VERSION`, add the old version to
   `READABLE` in the archive module when it can be read, regenerate the schema and the
   contract fixture, and add a migration test.
3. Build the viewer (`npm run build` in `apps/web`), then the wheel and the sdist
   (`uv build`). Check that the wheel contains `server/static/index.html`,
   `server/viewer/viewer.js`, and `server/viewer/viewer-lite.js`.
4. Install the wheel with all extras in a clean environment without Node.js. Run
   `datawalk doctor` and `datawalk demo` (stop it with Ctrl+C: no traceback), export the demo
   to HTML, a static site, and PDF, and import a notebook.
5. Build the hub image (`docker build -f packages/hub/Dockerfile .`) and start it.

## 5. Publish

1. Write the release notes in [CHANGELOG.md](../CHANGELOG.md): new features, changes in
   behavior, known limitations, and the archive format version.
2. Push a tag with the version, for example `git tag v0.1.0a1 && git push origin v0.1.0a1`.
   The release workflow builds the viewer and the packages, installs the wheel in a clean
   environment, writes checksums and a signed build provenance, and publishes the GitHub
   release with the install command.
3. PyPI: the name `datawalk` belongs to another project. Choose a distribution name first,
   then add a publishing step with PyPI trusted publishing.
4. Update [roadmap.md](roadmap.md) and [production-readiness.md](production-readiness.md).
