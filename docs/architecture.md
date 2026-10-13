# Architecture

## Layers and ownership

| Layer | Owner | Responsibility |
|---|---|---|
| Adapters | Python `datawalk.adapters` | Convert figure objects into a `Source`, a payload and a preview image |
| Importers | Python `datawalk.importers` | Notebooks, files, Altair, Bokeh, Styler, MLflow, PDF pages; SVG sanitizing |
| Report model | Python `datawalk.core.models` | Registry, rooms, user overrides, tour, summary, brand, label. The JSON form is the contract |
| Archive | Python `datawalk.serialization.archive` | `.dwk` read and write, with validation |
| Local server | Python `datawalk.server` | HTTP API, the built viewer, and the editor's writes, on `127.0.0.1` |
| Exports | Python `datawalk.export` | Export review, HTML, static site, PDF, PPTX, GLB, USDZ, video |
| Policy | Python `datawalk.policy` | Classification labels and their export policies |
| Viewer | TypeScript `apps/web` | Layout, rendering, navigation, inspection, editor, tour, flat view |
| Hub (optional) | Python `packages/hub` | Sign-in, permissions, revisions, comments, audit, live follow |
| AI guide (optional) | Python `datawalk.guide`, TypeScript `apps/web/src/guide` | Plans and narrates a presentation, answers questions (local model) |

Python owns all data. TypeScript owns all geometry. The two layers share only the JSON contract:

- `GET /api/report`: the report model (no payloads).
- `GET /api/visualizations/{id}/payload`: chart data (`series`, `plotly`, `kpi`, `table`,
  `text`, `vegalite`, `svg`, or `bokeh`).
- `GET /api/visualizations/{id}/preview.png`: the preview image, when one exists.
- `GET /api/datasets/{id}.csv`, `GET /api/brand/logo.png`, `GET /api/vendor/bokeh/...`.
- `GET /api/session`: whether the caller holds the editor token, the archive file name, the
  classification labels (editor), and the hub information (on a hub).
- `PUT /api/report`: editor save. Needs the token. See ADR-10.
- `PUT /api/visualizations/{id}/preview.png`: a preview that the editor rendered (Plotly).
- `POST /api/export/review`, `POST /api/export/html`: the editor's export review and export.
- With `--guide` only: `GET /api/guide/status`, `POST /api/guide/plan`, `POST /api/guide/ask`,
  `POST /api/guide/speech`. See ADR-25.

The same viewer runs in three ways (ADR-14): from the local server, as a static site
(`data/...` files), and as one HTML file (`window.__DATAWALK_DATA__`).

The generated JSON Schema is `packages/schema/generated/report.schema.json`.
`example-report.json` in the same folder (written by `packages/schema/make_example.py`)
sets every field. Pydantic must round-trip it exactly, and Zod must parse it strictly. So a
field that exists on one side only fails a test. The file also holds arrays encoded by
plotly.py's own encoder; the viewer's decoder must reproduce their exact values.

## Architecture decision records

**ADR-1: Separate source data from user data.** Each visualization has a `source` record and
an `overrides` record. A refresh (`add(..., update=True)`) replaces `source` only. Names,
descriptions, explanations and room assignment survive a rerun. The stable `key` matches a
new figure to an existing visualization. A duplicate key without `update=True` is an error.

**ADR-2: Three fidelity modes.** `interactive` (Plotly figure JSON), `structured` (preview
plus exactly recovered line and scatter values) and `static` (preview only). An adapter
returns data only when it recovers the data exactly. It lists all other content in
`Source.limitations`. Categorical scatter positions, bars, heatmap cells and filled areas
stay image-only.

**ADR-3: Previews where they are cheapest.** Matplotlib renders its own PNG at about
1800 px wide. Plotly previews are rendered in the browser with `Plotly.toImage`, at the
figure's own size and 2x pixel scale. Kaleido and Chrome are not required in Python.

**ADR-4: Layout runs in the viewer.** Room geometry belongs to the theme, and themes live in
the viewer. `layouts/wallLayout.ts` is a pure, deterministic function. Manual placements go
first; automatic displays flow around them, the doors and each other. Each kind of display
has a readable size (charts 3 m x 1.5 m, dashboards 5.2 m x 2.1 m). The layout never shrinks
displays: it grows the room in 2 m steps up to 24 m x 22 m, and reports what still does not
fit as overflow (shown on the room map). Python `auto_arrange` splits rooms that hold too
many items.

**ADR-4a: Placements are wall-local and normalized.** A manual placement is
`{wall, u, v, width, locked}`, with `u` and `v` in 0..1 along and up the wall. It survives
room resizing and will survive theme changes. Arrange mode validates against doors and other
manual displays only; automatic displays move out of the way.

**ADR-5: One persistent WebGL canvas.** The canvas stays mounted. The room content remounts
for each room, so React Three Fiber disposes its geometry and materials. Preview and label
textures are disposed explicitly.

**ADR-6: DOM inspector.** Detailed inspection uses a DOM overlay with the original Plotly
figure or the full-resolution image, not a 3D panel. This keeps axes readable and mouse
interaction exact.

**ADR-7: Chart colors are not lit.** Display screens use an unlit, non-tone-mapped material.
Room lighting cannot change the colors of a chart.

**ADR-8: WebGL first.** WebGPU is a later option.

**ADR-9: Rerun keeps the presentation.** `Report.save(path)` merges when the file exists and
this object did not come from it (the typical analysis rerun). The file's presentation wins:
report name, rooms, dashboards, placements, themes, and every non-empty user field. Script
values fill only empty fields. Matching is by stable key only. A key whose library or chart
type changed raises `MergeConflict`. Missing keys stay, marked "removed", with their data,
so notes are never lost silently. New keys go to the room the script names (matched by the
room's Python key, so editor renames do not break it).

**ADR-10: One writer path.** The editor holds the full report in the browser, with undo and
redo (snapshot history, 100 steps). Save sends the whole report with `PUT /api/report`.
The server accepts only user-owned data (`Report.apply_presentation`): source data, keys and
statuses stay as the server has them, and only "removed" visualizations may be deleted.
The revision number gives optimistic concurrency (409 on conflict). The server writes the
archive when the report has a file; otherwise the edits stay in the Python object.

**ADR-11: Native 3D exhibits.** Plotly `scatter3d` and `surface` figures stand on pedestals
in the room. Data maps into a 1.1 m cube per axis range (log axes in log space); plot z is up.
Tick labels and the crosshair readout use the original values. Figures with other 3D traces,
non-numeric coordinates or more than 300,000 points show a note instead of an approximation.

**ADR-12: Rooms form a ring.** With three or more rooms, the left door leads to the previous
room and the right door to the next. The visitor arrives at the door that leads back.

**ADR-12a: Themes are data, assets are CC0.** A theme is two JSON files:
`assets/themes/<id>/theme.json` (lighting, environment map, window view, surface materials,
display style, door) and `room.json` (height, minimum size, windows, skylight, pilasters,
beams, furniture anchors, pendants). Geometry for walls, windows, and furniture placement
comes from code (`themes/geometry.ts`) that reads these files; the layout avoids blocked wall
parts and furniture footprints. All models, materials, and environment maps come from Poly
Haven (CC0). `npm run assets` downloads them, checks SHA-256 hashes, and converts them:
KTX2 textures (ETC1S for color and ORM, UASTC for normal maps), Meshopt geometry, and smaller
HDR files. `assets/manifest.json` records the source, authors, license, and hashes of each
asset.

**ADR-13: The tour is user data.** `Report.tour` is a list of stops (`ref`, `notes`,
`duration`). An empty tour means the default order. A rerun keeps a tour that a person edited
(`ReportModel.edited`, set by the server); otherwise the script's tour applies. The viewer and
Python resolve stops the same way (tested). The tour camera plans a path on a 0.25 m grid
(A* with line-of-sight smoothing) around the theme's furniture and the exhibits.

**ADR-14: One viewer, three data sources.** `api.ts` reads from the local server, from
`data/` files next to `index.html` (static site, marked by a meta element), or from inline
data (single file). All asset URLs go through `asset()`, which maps them to inline data URLs
in a single file. `vite build --mode viewer` builds one script without the editor (the
editor code is tree-shaken). Python adds the data and the theme assets that the report uses.

**ADR-15: The summary room is ordinary content.** `add_summary` creates a first room, a KPI
dashboard, and Markdown text panels with links to the supporting charts. So the flat view,
the tour, PowerPoint, and the navigator need no special cases. DataWalk never writes
findings.

**ADR-16: Text without HTML.** Text panels use a small Markdown parser that returns data;
React and the canvas renderer draw it. Raw HTML stays text. SVG files and outputs pass an
allowlist sanitizer (elements, attributes, URL references).

**ADR-17: Exports that need a browser use the viewer.** PDF, PPTX images, GLB, USDZ, and
video open the single-file export in a headless browser (Playwright) and call hooks
(`window.datawalkExport`). The exported images are the wall images, made by the same code.

**ADR-18: Policy before export.** `datawalk.policy.check_export` runs before any export
writes a file: CLI, editor, and hub. The label of a report is user data (editor-editable,
kept on rerun when edited).

**ADR-19: The hub stores archives, not a database copy.** Each revision is the published
`.dwk` file, encrypted (AES-256-GCM, record-bound associated data). The hub reads it with the
library's archive reader (same validation), and keeps decrypted reports in a small memory
cache. SQLite holds users, permissions, links, comments (text encrypted), and the audit log.

**ADR-20: Live follow sends state, not video.** A WebSocket per report carries the
presenter's tour stop or camera pose (4 times a second at most) and the attendees' follow
state. Each attendee's browser renders the room itself.

**ADR-21: BokehJS from the author's environment.** Bokeh JSON works only with BokehJS of the
same version. The server, the hub, and exports take BokehJS from the installed `bokeh`
package and refuse a version mismatch. The viewer bundle contains no BokehJS. DataWalk
removes the JavaScript of Bokeh models with code (`CustomJS` and similar) when it imports or
reads a chart: a report must not run code in the browser of the person who opens it.

**ADR-22: Walking collisions on the floor plan, not a physics engine.** The visitor is a
circle; walls, furniture footprints, and pedestals are rectangles (`navigation/collision.ts`).
Movement goes in sub-steps of 10 cm per axis, so the visitor slides along what it touches and
cannot pass through thin furniture. The same rectangles drive the layout and the tour
camera's paths. This replaced the Rapier physics engine: 2.2 MB less in every export, and the
scene chunk is 0.77 MB instead of 3.4 MB.

**ADR-23: Two export viewers.** `viewer.js` contains Plotly and Vega; `viewer-lite.js`
(`vite build --mode viewer-lite`) replaces them with a stub. An export uses the lite viewer
when no chart needs a chart library (no Plotly, Vega-Lite, or Bokeh payload, and no linked
views): 1.6 MB instead of 6.9 MB.

**ADR-24: One export path.** `plan_export` (policy check, missing preview images, review
text), `confirm`, and `run_export` serve the CLI, `Report.export`, the editor, and the hub.
Each entry point shows the same review and enforces the same rules.

**ADR-25: The AI guide proposes; DataWalk checks and acts.** The guide is opt-in (`--guide`)
and local. Python (`datawalk.guide`) turns the report into a compact text with short aliases
(S1, S2, ...) for each room, chart, and dashboard, and asks a local model (Ollama) for a plan or
an answer in a JSON schema that allows only these aliases and five tools. Python then
resolves every alias, validates every action, and removes each sentence with a number that
the data of its stop does not contain; without a usable answer it uses the report's own text.
Chart data goes to the model only on demand, as a few statistics. Every request starts with
the same report text, so the model's prompt cache serves it. A plan is a list of `TourStop`s:
the viewer presents it with the tour engine (`store.guideTour`, `activeStops`), and
`TourCamera` reports arrival (`store.tourArrived`). The viewer's guide waits for events
(arrival, the end of each audio clip) and follows `stopIndex`, so the clicker, the HUD, and the
guide's own actions share one path. Speech: Kokoro-82M clips (WebAudio) or the browser's
voices; facial animation: optional Audio2Face-3D frames (ARKit names) on the audio clock, else
lip sync from the audio. The guide is a separate chunk and no export build contains it.
Alternatives not chosen: a second navigation engine (two sources of truth), model-run tool
calls (the model would act), a cloud model (the report would leave the computer). Details:
[guide.md](guide.md).

## Security

- The server binds to `127.0.0.1`. A port of 0 lets the OS pick a free port.
- `TrustedHostMiddleware` rejects DNS-rebinding requests.
- Reading is open to the local machine. Writing needs a per-session token
  (`secrets.token_urlsafe`, compared in constant time). The token travels in the URL
  fragment, which browsers do not send to servers or in `Referer`. The viewer moves it to
  `sessionStorage` and removes it from the address bar. Read-only callers do not learn the
  archive file name.
- No CORS headers: other origins cannot send the `Authorization` header to the API.
- A strict Content-Security-Policy blocks all requests to other origins. `'wasm-unsafe-eval'`
  is for the texture transcoder (Basis) and the mesh decoder (meshopt). `'unsafe-eval'` is for
  Plotly.js WebGL traces and the Vega expression parser. Bokeh charts lose their JavaScript
  callbacks on import (ADR-21), so `'unsafe-eval'` does not let a report run its own code.
- The viewer drops Plotly layout images that are not `data:` URLs.
- React escapes all text. The viewer does not inject HTML.
- `.dwk` reading accepts only known entry names. It limits entry count, entry size, total
  size and compression ratio, and does not trust ZIP header sizes. It parses JSON only and
  validates it with Pydantic. A preview must be a PNG.
- `.dwk` writing is atomic. The file gets owner-only permissions (0600) because reports can
  be confidential. Change the permissions yourself to share the file.
- Exports: the single HTML file has a CSP `<meta>` element with SHA-256 hashes of its inline
  scripts and `default-src 'none'`; `connect-src` permits only `data:` and `blob:`. Vega and
  BokehJS get a loader that refuses URLs. Inline JSON escapes `<`, U+2028 and U+2029.
- Notebook import never runs code unless the author asks (`--execute`, separate process,
  timeout).
- AI guide (opt-in): the routes exist only with `--guide`; they accept only same-site JSON
  (`Content-Type: application/json`, `Sec-Fetch-Site`), so another website cannot start the
  model with a form or a no-cors request. Model and Audio2Face addresses must be loopback
  unless `DATAWALK_GUIDE_ALLOW_REMOTE=1`. Report text reaches the model as data; the model's
  output is validated and runs no code. Audio2Face frames are validated (shape, count, range).
  The microphone uses on-device recognition only (`processLocally`). The CSP is unchanged.
- Hub: CSRF protection by origin check on every cookie-authenticated change; SAML responses
  must be signed by the configured certificate and are read from the signed element only,
  with replay protection by assertion id; OIDC uses PKCE, state, and nonce; an e-mail address
  never opens an account that has a password (the owner connects single sign-on on the
  Account page), and an unverified OIDC e-mail is not used; passwords use scrypt; session and
  API tokens are stored as SHA-256 hashes; the viewer and the WebSocket check access on every
  request; `frame-ancestors` allows only configured HTTPS origins.

## Dependency licenses (checked 2026-10-09)

| Package | License |
|---|---|
| react, three, @react-three/fiber, @react-three/drei, zustand, zod, plotly.js, suspend-react | MIT |
| vega, vega-lite, vega-embed | BSD-3-Clause |
| @axe-core/playwright (tests only) | MPL-2.0 |
| fastapi, pydantic, plotly, python-pptx, openpyxl | MIT |
| xlrd | BSD-3-Clause |
| uvicorn, starlette, seaborn, nbformat, nbclient, ipykernel, bokeh, altair, jinja2, authlib, lxml | BSD-3-Clause |
| playwright, signxml | Apache-2.0 |
| cryptography, pypdfium2 | Apache-2.0 or BSD-3-Clause |
| matplotlib | Matplotlib license (PSF-style, permissive) |
| kokoro-onnx (`voice` extra) | MIT; its dependencies phonemizer and espeak-ng are GPL-3.0, so `voice` is not in `all` and nothing is bundled |
| Kokoro-82M weights (downloaded by the user) | Apache-2.0 |
| nemotron-3-nano:4b (pulled by the user into Ollama) | NVIDIA Open Model License |
| Audio2Face-3D SDK (not bundled; a separate bridge) | MIT; models: see NVIDIA's model cards |
| Room assets (Poly Haven) | CC0-1.0, see [credits.md](credits.md) |

All licenses are compatible with MIT distribution. MPL-2.0 applies to a test tool only.

## Deferred and unsupported

- Seaborn objects interface (`so.Plot`): not supported.
- Dash: only Plotly figures taken from a Dash app. No callbacks or servers.
- Splitting subplots into separate visualizations: not built.
- Arrow and Parquet datasets: not needed yet. Datasets are CSV in the `.dwk` file.
- Project model (several reports): not built.
- Power BI and Tableau files: not read (a non-goal). Their PDF and image exports work.
