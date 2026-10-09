# Roadmap and status

Last update: 2026-10-09.

## Plan phases

| Phase | Status |
|---|---|
| 0. Research and architecture | Done. See [architecture.md](architecture.md). |
| 1. Repository and foundation | Done. The wheel installs in a clean environment and runs without Node.js. |
| 2. Visualization import | Done: Matplotlib, Seaborn, Plotly, pandas; later also Altair, Bokeh, Styler, files. |
| 3. First walkable room | Done. |
| 4. First production themes | Done: Executive Office and Dark Gallery, with CC0 assets from Poly Haven. |
| 5. Multi-room system | Done: doors, map, navigator, teleport; mouse look stays after a door (regression test). |
| 6. Complete inspection | Done, including linked views across charts. |
| 7. Editor | Done, including theme previews and keyboard arrange mode. |
| 8. Remaining eight themes | Done: 10 themes. Every theme loads without errors (end-to-end test). |
| 9. Persistence and distribution | Done: datasets, export review, single HTML file, static site, watermarks, flat view. |
| 10. Release | Partly done: tests, measurements, documentation, release checklist, wheel check. Not done: a published release. |

## Addendum A phases

| Phase | Content | Exit criterion | Result |
|---|---|---|---|
| 11 | Tour model, controls, camera glide, presenter view, summary room | Demo presented with a clicker only | **Pass.** `e2e/tour.spec.ts` presents all 27 stops with Page Down and Page Up only, and checks that each target is framed. |
| 12 | Single HTML, static site, export review, flat mode, PDF | Offline zero-request test passes | **Pass** in Chromium, Firefox, and WebKit (`e2e/export.spec.ts`). Edge was not tested separately (Chromium engine). |
| 13 | Notebook importer, Tier 1 importers, text panel | Notebook example and re-import test pass | **Pass.** `tests/test_notebook.py`: three H2 sections give three rooms with the correct modes and Markdown descriptions; a re-executed notebook keeps all editor changes. |
| 14 | PPTX export, GLB/USDZ export | Files open in PowerPoint, Blender, and Quick Look | **Partly verified.** Blender 5.2 imports the GLB (names and extras present) and the USDZ. Apple `usdchecker --arkit` accepts the USDZ. Quick Look renders the PPTX. PowerPoint itself was not available on the test machine. |
| 15 | Hub: publish, SSO, permissions, versions, comments, audit, embedding, live follow | Two-browser live-follow test passes | **Pass.** `e2e/hub.spec.ts`: an attendee follows, breaks away, and snaps back; the presenter sees it. OIDC and SAML pass against test identity providers. The Docker image build was not run locally (no Docker daemon); CI builds it. |
| 16 | Classification labels, CI recipe, `doctor`, performance presets | Scheduled CI publish runs end to end | **Pass.** `tests/test_ci_recipe.py` runs the recipe against a live hub: first publish, an editor change, a rerun with new data. |

## Tests

| Suite | Count |
|---|---|
| pytest (library and hub) | 91 |
| Vitest | 86 |
| Playwright | 27 tests in 8 projects (Chromium, Firefox, WebKit) |

All pass on 2026-10-09 (macOS, Apple M2). The wheel installs with all extras and exports in a
clean Python 3.12 environment without Node.js. See
[production-readiness.md](production-readiness.md) for the readiness criteria, the security
review, and the measurements.

## Known limitations

- Pointer Lock is not available in some embedded browsers. Arrow keys then turn the view, and
  dragging with the mouse looks around.
- A Bokeh chart needs the same `bokeh` version on the machine that serves or exports the
  report.
- Vega-Lite charts that load data from a URL show no data: the viewer loads no external data.
- A static site needs an HTTP(S) server; opened from disk, browsers block its data requests.
- The single HTML file of the demo is 18.6 MB; the viewer alone is 6.9 MB (1.6 MB for reports
  without Plotly, Vega-Lite, or Bokeh charts).
- The name `datawalk` on PyPI belongs to another project: the release needs another
  distribution name.
- PPTX, PDF, GLB, USDZ, and video exports need Playwright and a Chromium-based browser.
- The hub uses SQLite. For many concurrent publishers, use a server database (not built).
- Live follow and the SAML replay check keep their state in the memory of one hub process
  (no multi-process scaling).
- In 3D on a touch screen, walking needs a keyboard; phones and tablets open the flat view.
- Script values do not replace earlier non-empty user values on rerun (ADR-9). To force a
  script value, use `merge=False` or edit it in the editor.
- Performance numbers come from one machine (Apple M2); see [performance.md](performance.md).

## Next steps

1. Publish the first release ([release-checklist.md](release-checklist.md)).
2. Test the exports in PowerPoint and Keynote on Windows and macOS.
3. Measure performance on an integrated GPU and in a virtual desktop.
4. More catalogs for the user interface (English and German exist).
