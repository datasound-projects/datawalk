# Installation

DataWalk needs Python 3.11 or later. Viewers of an exported report need only a browser.

```bash
pip install "datawalk[all]"         # every feature
datawalk demo                       # check: a demo report opens in the browser
```

> **Note:** The name `datawalk` on PyPI belongs to another project at this time. Until
> DataWalk is published under its own name, install the wheel from a release, or build it
> from a source checkout:
>
> ```bash
> pip install "datawalk-0.1.0.dev0-py3-none-any.whl[all]"
> ```

## Extras

`all` installs every extra. To install less, choose the extras that you use.
`datawalk doctor` shows what is installed.

| Extra | Adds | Needed for |
|---|---|---|
| (none) | The core | Reports, the viewer and editor, HTML and static-site exports |
| `charts` | Matplotlib, Seaborn, Plotly, pandas, NumPy | Charts from these libraries; `datawalk demo` |
| `matplotlib`, `seaborn`, `plotly` | One plotting library each | Charts from that library |
| `excel` | openpyxl, xlrd | Excel files (`.xlsx` and `.xls`) |
| `notebook` | nbformat, nbclient, ipykernel | `datawalk import --execute`, `datawalk open --execute` |
| `pdf` | Playwright | PDF, GLB, USDZ, and video exports; preview images for "preview only" |
| `pptx` | python-pptx, Playwright | PowerPoint export |
| `pdf-import` | pypdfium2 | PDF pages as charts |
| `all` | All of the above | Everything |

Altair, Bokeh, and MLflow are not extras: install them as usual when you use them.

**Browser for exports.** The `pdf` and `pptx` extras use Google Chrome or Microsoft Edge when
one is installed. Otherwise run `playwright install chromium` once.

**Video.** The tour video is MP4 when `ffmpeg` is on the PATH, else WebM.

**Quotes.** Put a package name with extras in quotes (`"datawalk[all]"`). Without quotes,
zsh (the default macOS shell) reports `no matches found`.

## The hub

The hub is a separate package and a Docker image. See [hub.md](hub.md).

## From source

See [CONTRIBUTING.md](../CONTRIBUTING.md). Building the viewer needs Node.js 22 or later; the
published package does not.
