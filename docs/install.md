# Installation

You need [uv](https://docs.astral.sh/uv/getting-started/installation/) and git. One command
installs DataWalk as the `datawalk` command (macOS, Windows, Linux):

```bash
uv tool install "datawalk[all] @ git+https://github.com/datasound-projects/datawalk"
datawalk demo                        # check: a demo report opens in the browser
```

uv gets a suitable Python, DataWalk, and its packages, and builds the viewer with its own copy
of Node.js. The first install takes a few minutes. If the shell does not find `datawalk`, run
`uv tool update-shell` and open a new terminal.

Viewers of an exported report need only a browser.

## Update

```bash
uv tool upgrade datawalk
```

This installs the latest version from GitHub (the `main` branch: every change there passed
all tests).

## The AI guide's voice (optional)

The AI guide speaks with the browser's voice. For the Kokoro voice, install with the `voice`
extra, then get its model files ([guide.md](guide.md#voice-kokoro-82m)):

```bash
uv tool install "datawalk[all,voice] @ git+https://github.com/datasound-projects/datawalk"
```

## Other ways

- **In your own Python code or notebooks:** in a virtual environment,
  `pip install "datawalk[all] @ git+https://github.com/datasound-projects/datawalk"`.
- **A fixed version:** the wheel of a [GitHub release](https://github.com/datasound-projects/datawalk/releases)
  (the viewer is inside; no build), for example
  `uv tool install "datawalk[all] @ https://github.com/datasound-projects/datawalk/releases/download/v0.1.0a2/datawalk-0.1.0a2-py3-none-any.whl"`.
- **pipx:** `pipx install` takes the same text as `uv tool install`.
- **From a clone, to develop:** see [CONTRIBUTING.md](../CONTRIBUTING.md).

> **Note:** The name `datawalk` on PyPI belongs to another project. Never install with a plain
> `pip install datawalk`.

## Extras

`all` installs every extra except `voice`. `datawalk doctor` shows what is installed and the
command that adds the rest.

| Extra | Adds | Needed for |
|---|---|---|
| (none) | The core | Reports, the viewer and editor, HTML and static-site exports, the AI guide |
| `charts` | Matplotlib, Seaborn, Plotly, pandas, NumPy | Charts from these libraries; `datawalk demo` |
| `matplotlib`, `seaborn`, `plotly` | One plotting library each | Charts from that library |
| `excel` | openpyxl, xlrd | Excel files (`.xlsx` and `.xls`) |
| `notebook` | nbformat, nbclient, ipykernel | `datawalk import --execute`, `datawalk open --execute` |
| `pdf` | Playwright | PDF, GLB, USDZ, and video exports; preview images for "preview only" |
| `pptx` | python-pptx, Playwright | PowerPoint export |
| `pdf-import` | pypdfium2 | PDF pages as charts |
| `voice` | kokoro-onnx | The AI guide's Kokoro voice. Not in `all`: its phonemizer is GPL-3.0 |

Altair, Bokeh, and MLflow are not extras: install them as usual when you use them.

**Browser for exports.** The `pdf` and `pptx` extras use Google Chrome or Microsoft Edge when
one is installed. Otherwise run `playwright install chromium` once.

**Video.** The tour video is MP4 when `ffmpeg` is on the PATH, else WebM.

**Quotes.** Put a package name with extras in quotes (`"datawalk[all]"`). Without quotes,
zsh (the default macOS shell) reports `no matches found`.

## The hub

The hub is a separate package and a Docker image. See [hub.md](hub.md).
