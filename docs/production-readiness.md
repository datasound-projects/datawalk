# Production readiness

Status on 2026-10-09, version 0.1.0a1. This page lists each readiness criterion, the
evidence for it, and the limitations that remain. It does not claim more than the tests show.

## Verdict

| Use | Ready? |
|---|---|
| Client demonstrations and sales presentations (`datawalk demo`, own reports, exports) | Yes |
| Pilots and internal use: analysts on their machines, exports to stakeholders | Yes |
| A self-hosted hub for one team (one hub process, HTTPS reverse proxy) | Yes, after the deployment checks below |
| `pip install datawalk` from PyPI | **No.** The name `datawalk` on PyPI belongs to another project. The owner must choose a distribution name (see "Open decisions") |

## Criteria and evidence

### 1. Every feature works and has tests

| Suite | Result |
|---|---|
| pytest: library and hub | 91 tests pass |
| Vitest: viewer logic | 86 tests pass |
| Playwright: end to end, 8 projects (Chromium, Firefox, WebKit) | 27 tests pass |
| ruff (lint and format), TypeScript (`tsc`), ESLint | No findings |

The end-to-end tests cover: walking, doors, mouse look after a door, inspection, the map,
the navigator, all 10 themes, GPU memory over repeated room changes, chart color fidelity,
the flat view with an automated WCAG 2.2 AA check (axe), the guided tour with a clicker, the
presenter view, kiosk mode, the editor (rename, undo, arrange, save, reload, themes, tour,
export review and download), offline single-file and static-site exports with zero network
requests in three browser engines, notebook and other sources, and live follow on the hub.

### 2. The package installs and runs in a clean environment

A new Python 3.12 environment outside the repository, with the wheel and all extras:

- `datawalk doctor`: every check passes (Chrome, GPU tier, ffmpeg, all extras).
- `datawalk demo`: builds the demo, serves it, and stops with Ctrl+C ("Stopped.", no
  traceback).
- `datawalk export` to a static site and a PDF: 6.8 s.
- `datawalk import` of a notebook, then an HTML export.

The wheel is 43.6 MB (198 files). It needs no Node.js.

### 3. Security

Three independent reviews ran: the library and its exports, the hub (with an authorization
matrix of every route), and the viewer. Each finding was reproduced, fixed, and covered by a
regression test.

| Finding | Severity | Fix |
|---|---|---|
| Hub: a single sign-on e-mail address could open an existing password account (account takeover) | High | An e-mail address opens only an account that waits for single sign-on (created with `--sso-only`). Password accounts connect single sign-on on the Account page. An unverified OIDC e-mail is not used |
| Hub: a SAML response could be used again with a different encoding (replay) | High | The replay check uses the signed assertion ID and the issuer |
| `publish` and `pull` could send the hub token over plain HTTP to another host (`http://localhost@evil.example`) | Medium | The hub address is parsed: HTTPS, or HTTP to `localhost` only, never with credentials in the address |
| A Bokeh chart in a report from someone else could run JavaScript in the viewer | Medium | DataWalk removes the code of Bokeh models (`CustomJS` and similar) when it imports or reads a chart |
| SVG: CSS after a child element of `<style>` was not cleaned | Low | The sanitizer cleans all text of a `<style>` element |
| Hub: chart-view counting had no CSRF origin check | Low | Origin check added |
| Hub: a publish request was read completely before the size check | Low | The hub stops reading at the size limit |
| Hub: viewer file path check, audit CSV formula cells, embedded public-link cookie | Low | Fixed (path containment, text cells, `SameSite=None` when embedding is on) |

Checked and found safe: link and comment access per report (no IDOR), SAML signature
wrapping, sign-in timing, session and token storage (hashes), CSRF on all other changes,
CSP and frame ancestors, HTML escaping in exports, archive limits and entry names, the
classification policy at every export entry point, Markdown links, notebook execution only on
request.

### 4. Reliability and clear errors

Common mistakes give one line that says what to do, and no traceback:

- a missing file, a folder instead of a file, a notebook given to the wrong command;
- a port that is in use;
- an export that would replace its own `.dwk` report, a missing PowerPoint template, a
  missing extra (checked before the review);
- an empty report, a notebook with nothing to show (with a list of what it has);
- a misspelled KPI setting, a sum of a text column, a row that does not exist;
- an invalid policy file (also in `datawalk doctor`);
- Ctrl+C or Ctrl+D at the confirmation prompt (the export is cancelled).

`DATAWALK_DEBUG=1` shows the full traceback for a bug report.

### 5. Performance

Measured on an Apple M2 with a report of 163 visualizations in 14 rooms (Matplotlib, Plotly
with up to 300,000 points, KPIs, tables with up to 200,000 rows, a room with 40 displays):

| Measurement | Result |
|---|---|
| Build the report in Python, save it | 3.7 s, 0.4 s (7.9 MB archive) |
| Viewer: lobby ready | 0.45 s |
| Frame rate in each room, the crowded room included | 61 fps (display limit) |
| Inspector with a 300,000-point Plotly chart | 0.28 s |
| Flat view with all 163 items | 3.9 s |
| 30 MB single HTML file from disk: first screen | 0.5 s, 0 network requests |
| Export review and HTML export | 0.2 s and 0.3 s |

Fixes from the review: an edit no longer reloads every display texture; Plotly images render
once per session; the crosshair hit test runs only when the view changes; the walking view
re-renders only for the state that it shows; window views of previewed themes leave GPU
memory after 30 s; surface exhibits respect the 300,000-point limit; the flat view no longer
loads three.js.

Sizes: the demo as one HTML file is 18.6 MB (was 20.7 MB), as a static site 15.8 MB. A report
without Plotly, Vega-Lite, or Bokeh gets a viewer of 1.6 MB instead of 6.9 MB. The physics
engine (2.2 MB) was replaced by a floor-plan collision module.

### 6. Usability

A visual review covered every screen at 1440 × 900 and 390 × 844, in English and German.
Fixed:

- the flat view on phones (the contents list covered the report);
- the inspector showed the previous item after an evidence link;
- large preview images were cut off in the inspector;
- Tab trapped the keyboard focus in the lobby and in dialogs; Esc did not close the editor;
- the hub bar covered the inspector's **Back to room** button;
- typing a comment during live follow left the presentation;
- attendees stayed in tour mode after the presenter left;
- the classification label covered the editor's **Save** button (now a banner above the
  views);
- dark brand colors made buttons and links unreadable (now lightened to 4.5:1 contrast);
- the lobby settings layout, table alignment, theme cards, and size labels ("< 1 KB").

New, for people without technical background:

- `datawalk demo`: one command shows a complete report.
- `datawalk open analysis.ipynb`: one command turns a notebook into a 3D report.
- Phones and tablets open the flat view; touch screens get on-screen buttons in 3D.
- Letter shortcuts follow the keyboard layout (German and French keyboards).

### 7. Accessibility

The flat view passes an automated WCAG 2.2 AA check (axe) in the end-to-end tests and works
with the keyboard only. Dialogs move the focus to their first control. Move buttons name
their item for screen readers. Text panels, KPIs, and tables are real text, not images.

### 8. Privacy and governance

No cloud service and no AI service are necessary. DataWalk never writes findings. Every
export shows the export review first, at every entry point (CLI, Python, editor, hub).
Classification labels limit exports and public links. The hub encrypts archives and comments
at rest (AES-256-GCM) and keeps an audit log.

## Remaining limitations

- **PyPI name.** `datawalk` on PyPI is another project. Until a name is chosen, install from
  a wheel or a source checkout.
- **No published release yet.** The CI workflow exists but was not run on a hosting service
  in this review. The hub's Docker image was not built here (no Docker daemon).
- **One hub process.** Live follow and the SAML replay cache are in the memory of one
  process, and the database is SQLite. Do not run several hub workers.
- **Hub pull.** Editors who pull a report get the complete archive, whatever its
  classification (the classification applies to exports and links).
- **OIDC e-mail.** The hub refuses an e-mail that the identity provider marks as not
  verified. Providers that send no `email_verified` claim (for example Microsoft Entra ID)
  are trusted for the address: configure one tenant only.
- **Touch screens.** In 3D on a touch screen, people look around, use the tour, the map, and
  the rooms list. Walking needs a keyboard. Phones open the flat view.
- **GPU memory in theme previews.** Window views of previewed themes leave GPU memory after
  30 s; their materials and models stay until the page reloads.
- **Bokeh.** JavaScript callbacks are removed. Serving or exporting needs the same `bokeh`
  version as the author's.
- **Vega-Lite** charts that load data from a URL show no data.
- **Static sites** need an HTTP(S) server.
- **Browser-based exports** (PDF, PPTX, GLB, USDZ, video) need Chrome, Edge, or Playwright's
  Chromium. A video records in real time (27 stops at 6 s: about 5 minutes).
- **Single-file size.** The demo is 18.6 MB. Large reports pass the 20 MB e-mail limit; the
  review warns and suggests a static site or preview-only charts.
- **Tested environments.** macOS on an Apple M2. Not measured: integrated GPUs and virtual
  desktops. PPTX files were checked in Quick Look, not in Microsoft PowerPoint. Edge was not
  tested separately (it uses the Chromium engine).
- **Languages.** The interface has English and German.
- **Reruns.** A script value does not replace a value that a person edited (by design,
  ADR-9). `merge=False` or the editor changes it.

## Open decisions for the owner

1. The distribution name on PyPI (free on 2026-10-09: `datawalk-3d`, `datawalk3d`,
   `datawalk-viz`, `datawalk-reports`). The import name `datawalk` can stay.
2. When to tag and publish the first release ([release-checklist.md](release-checklist.md)).

## How to verify

```bash
uv run ruff check packages tests && uv run pytest
cd apps/web && npx tsc --noEmit && npx eslint src e2e && npx vitest run
npm run build && npx playwright test
```
