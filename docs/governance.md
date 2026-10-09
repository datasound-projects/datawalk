# Governance and automation

## Classification labels

A report can have a classification label, for example "Confidential". The label shows in
every view (3D, flat view, presenter view), on every printed page, in the title of an
exported HTML file, on every PowerPoint slide, and in GLB metadata. Each label has an export
policy. The export command, the editor's export, and the hub apply it.

```python
report.classify("Confidential")
```

Or select the label in the editor (**Report** tab). A rerun keeps a label that a person
changed in the editor.

Built-in labels and policies:

| Label | Policy |
|---|---|
| Public | No limits |
| Internal | No public links |
| Confidential | No public links, no datasets, watermark required |
| Strictly confidential | No public links, no datasets, preview images only, watermark required, exports: PDF and PPTX |

Use your own labels: write a JSON file and set `DATAWALK_POLICY` to its path (on analyst
machines, CI runners, and the hub). Your labels **replace** the built-in labels: a report
that has a built-in label (for example "Confidential") needs that label in your file too.
`datawalk doctor` checks the file.

```json
{"labels": {
  "Internal": {"public_links": false},
  "Client confidential": {"public_links": false, "datasets": false, "watermark": true,
                          "formats": ["html", "pdf", "pptx"]}
}}
```

| Field | Meaning (default: allowed) |
|---|---|
| `public_links` | Hub links without sign-in |
| `datasets` | Attached datasets in exports |
| `data` | Chart data in exports; `false` permits preview images only |
| `watermark` | `true` requires a recipient watermark on every export |
| `formats` | Allowed exports: `html`, `site`, `pdf`, `pptx`, `glb`, `usdz`, `video` |

## Report as code

`examples/ci/report-as-code.sh` rebuilds a report on a schedule:

1. `datawalk pull` gets the latest revision from the hub, with the presentation edits.
2. The analysis script runs and calls `report.save()`, which merges: new data, and the edits
   stay.
3. `datawalk export` writes HTML and PDF. The review prints to the job log, and the
   classification policy applies.
4. `datawalk publish` adds a revision. The hub records what changed, with the KPI deltas.

Use it with GitHub Actions (`examples/ci/github-actions.yml`) or GitLab CI
(`examples/ci/gitlab-ci.yml`). Store `DATAWALK_HUB_TOKEN` as a CI secret. On the first run,
leave `REPORT_ID` empty; then set it to the id that `publish` shows. The test
`tests/test_ci_recipe.py` runs the script end to end against a live hub.

The workflow file holds the export options (for example the watermark). Review changes to it
like other code: `--yes` in the script confirms the export review for every scheduled run.

## datawalk doctor

```bash
datawalk doctor
```

It checks the Python version, the built viewer, every optional extra, ffmpeg, the
classification policy file (`DATAWALK_POLICY`), the hub (`DATAWALK_HUB`), and the browser.
With Playwright installed, it starts Chrome, Edge, or Chromium, reads the WebGL renderer, and
reports the GPU tier.

## Performance and locked-down machines

The viewer reads the GPU from the WebGL renderer string. No benchmark downloads.

| GPU | Quality preset |
|---|---|
| Discrete GPU, Apple M series | High |
| Unknown | Medium |
| Integrated GPU (Intel, Mali, Adreno, ...) | Low |
| Software rendering, virtual desktops (VDI) | Low, and the flat view opens first |
| No WebGL | Flat view only |

The visitor can change the preset in the lobby. Measurements: [performance.md](performance.md).

## Browser support

The latest two versions of Chrome, Edge, Firefox, and Safari. See
[exports.md](exports.md#browser-support) for the tests.

## Localization

All user interface text is in message catalogs: `apps/web/src/i18n/` for the viewer and the
editor, `packages/hub/datawalk_hub/i18n.py` for the hub. English and German are included.
The viewer takes the language from `?lang=`, the lobby's language setting, or the browser.
The hub takes it from `?lang=`, a cookie, or the browser's `Accept-Language` header. To add a
language, add a catalog with the same keys; the tests check that every key and placeholder
matches English.
