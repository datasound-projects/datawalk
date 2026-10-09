# Exports and sharing

Every export is a data release. Before DataWalk writes a file, the **export review** shows
what leaves the machine. Confirm the review, or change it.

## Export review

The review lists, for each chart:

- the data level: **preview only** (an image), **chart data**, or **chart data + datasets**,
- the number of data points that the export contains,
- the size, and the total size of the export.

You can reduce any chart to **preview only** (`all` reduces every chart). A chart without a
preview image gets one: DataWalk draws it with the viewer (this needs `datawalk[pdf]`). You
can add a recipient watermark. Datasets are in an export only on request (`--datasets`).

```bash
datawalk export report.dwk                                   # report.html (the default)
datawalk export report.dwk --preview-only price volume --watermark "Board copy: J. Smith"
datawalk export report.dwk --site site/ --pdf --yes          # two outputs, no prompt
```

In Python, the format follows the file name:

```python
report.export("report.html", "site/", "report.pdf", preview_only="all", watermark="Board copy")
```

Without `--yes` (`yes=True` in Python), DataWalk shows the review and asks for confirmation.
Without a terminal (for example in CI), it stops unless you give `--yes`. In the editor, the
**Export** tab shows the same review; the download starts only after you confirm it.

DataWalk checks the outputs before the review: an export never replaces a `.dwk` report,
and a file name that is a folder, or a PowerPoint template that does not exist, is an
error. A new static site replaces an earlier DataWalk export in the same folder, but never a
folder with other contents.

The report's classification label can limit exports (see [governance.md](governance.md)).

## Formats

| Format | Command | Contents | Demo size |
|---|---|---|---|
| Single HTML file | `--html [path]` (the default) | Viewer, data, images, and the theme assets, all inline | 18.6 MB |
| Static site | `--site out/` | The same, as separate files with relative paths | 15.8 MB |
| PDF | `--pdf [path] --paper a4\|letter` | The flat view, one chart per block, the table of contents first | 1.9 MB |
| PowerPoint | `--pptx [path] [--template t.potx]` | One slide per tour stop | 1.9 MB |
| GLB | `--glb [path]` | A static 3D snapshot of the rooms | 3.0 MB |
| USDZ | `--usdz [path]` | The same, for Apple Quick Look | 3.0 MB |
| Video | `--video [path] --seconds 6` | The guided tour as MP4 (see [presenting.md](presenting.md)) | 94 MB (27 stops, 6 s each, about 5 min) |

Sizes: the demo report (25 visualizations, 4 rooms, Executive Office theme), measured on
2026-10-09. Of the 18.6 MB HTML file, the viewer is 6.9 MB, the theme assets are 7.8 MB, and
the report data is about 1 MB; base64 encoding adds a third to the binary parts. The theme
decides much of the size: Dark Gallery needs 3.2 MB of assets, Executive Office 7.8 MB.

**Smaller files.** A report without Plotly, Vega-Lite, or Bokeh charts (for example
Matplotlib charts, KPIs, and tables) gets a smaller viewer without the chart libraries:
1.6 MB instead of 6.9 MB. A Matplotlib and KPI report with the Executive Office theme is
about 12 MB as one HTML file.

**Size limit.** Many e-mail services accept 20 MB at most (Outlook: 20 MB; Gmail: 25 MB).
Above 20 MB, the review says so and suggests a static site or preview-only charts.

PDF, GLB, USDZ, and video need `datawalk[pdf]` (Playwright) and Chrome, Edge, or Playwright's
Chromium. PPTX needs `datawalk[pptx]`. The video export prints its progress; it records in
real time.

### Single HTML file

- Opens from disk (`file://`), from an e-mail attachment, or from a SharePoint or Google
  Drive preview that runs scripts. It needs no Python, no Node.js, and no network.
- Makes no network requests. A Content-Security-Policy in a `<meta>` element blocks every
  request to another origin.
- Contains the viewer only: no editor code.
- Contains the report revision, the export time, and a SHA-256 content hash (lobby, and the
  `datawalk-export` meta element).
- The review warns above 20 MB, a usual e-mail limit, and suggests the static site.
- Opens the flat view when the browser has no WebGL.

### Static site

Copy the folder to any static web host: S3, GitHub Pages, an internal web server, or a
SharePoint document library that serves HTML. All paths are relative.

**Hosting limitations.**

- Serve the folder over HTTP(S). Opened from disk, browsers do not run a site; the page then
  says how to serve it (for a quick test: `python -m http.server` in the folder). Use the
  single HTML file for disk use.
- The content types that the host sends for `.json`, `.ktx2`, `.glb`, and `.hdr` files do not
  matter: the viewer reads them as data.
- Some SharePoint configurations download `.html` files instead of showing them. Then use the
  hub, or the single HTML file.
- Everyone who can read the folder can read all its data. Use the host's access control.

### PDF

The PDF prints the flat view: the table of contents, then one section per room, one chart per
block, with clean page breaks. Text is selectable. Without the CLI, open the flat view in a
browser and print it (A4 or Letter from the print dialog).

### PowerPoint

One slide per tour stop. Each slide has the title, the chart image at its native aspect ratio
(the same image as the wall display), the findings as bullets, and the speaker notes. KPIs,
tables, and text panels are native PowerPoint text. A footnote marks charts that are
interactive only in DataWalk. The default template is neutral (16:9). `--template` takes your
`.potx` or `.pptx` file and uses its layouts and theme.

### GLB and USDZ

The rooms stand side by side, without ceilings, with the chart images on the walls. Screens
use `KHR_materials_unlit` in GLB, so chart colors stay exact; USDZ has no unlit material, so
the screens are emissive. Node names carry the chart names; glTF `extras` carry the keys and
the explanations. Target viewers: Windows 3D Viewer, Blender, PowerPoint and Keynote 3D
models, Apple Quick Look (USDZ).

**A world file is a static snapshot.** It has no interaction, no data payloads, and no
inspector. 3D exhibits show their image on a panel.

## Flat view

The flat view shows the same report as a scrollable page: the summary first, one section per
room, the items in room order. It has a table of contents and a deep link to each chart
(`#viz-<key>`). Interactive Plotly and Vega-Lite charts load when they scroll into view.

- Switch between 3D and flat at any time (**Flat view** in the lobby, **Walk in 3D** in the
  flat view). The switch keeps the current room.
- The viewer opens the flat view automatically when there is no WebGL, when the GPU renders
  in software, and on phones and tablets (touch screens without a mouse). `?view=flat` and
  `?view=3d` choose a view.
- Accessibility: semantic headings, alt text from the chart name, description, and axes,
  full keyboard use with a skip link, and real table markup. An automated axe check for
  WCAG 2.2 AA runs in the end-to-end tests.

## Browser support

The latest two versions of Chrome, Edge, Firefox, and Safari. The end-to-end tests open the
single HTML file and the static site with all network access blocked in Chromium, Firefox,
and WebKit (the Safari engine), and record zero requests. Edge uses the Chromium engine.
