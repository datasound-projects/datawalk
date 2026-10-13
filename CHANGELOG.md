# Changelog

## Unreleased

- AI guide (opt-in, `--guide`): a small animated avatar plans a 3, 5, or 10-minute
  presentation, moves the camera from stop to stop, explains each stop aloud with captions,
  and answers questions. A local model (Ollama, `nemotron-3-nano:4b`) writes the text;
  DataWalk checks every stop, number, and action. Without a model it presents with the
  report's own text. Optional: Kokoro-82M voice (`voice` extra), NVIDIA Audio2Face-3D facial
  animation (not verified on NVIDIA hardware), spoken questions with on-device recognition.
  `datawalk doctor` checks the components. See docs/guide.md.

## 0.1.0a2 (2026-10-09): installs that work everywhere

- Windows: text files are UTF-8 everywhere (a web-folder export with a title such as
  "AI → Water" failed), and the command line works on any console code page.
- Install as a command with `uv tool install` or `pipx install`; Python from Homebrew and
  Linux distributions refuses a plain `pip install` (PEP 668).
- Messages about a missing extra show a command that works for your installation, always
  with the GitHub release ("datawalk" on PyPI is another project).
- Tested on Linux, macOS, and Windows; the public release is installed with uv, pipx, and
  pip each week.

## 0.1.0a1 (2026-10-09): first public alpha

- Turn Jupyter notebooks, Python charts (Matplotlib, Seaborn, Plotly, Altair, Bokeh), pandas
  tables, images, CSV and Excel files, PDF pages, and MLflow runs into walkable 3D rooms.
- `datawalk open analysis.ipynb`: a notebook becomes a 3D report with one command.
- `datawalk demo`: a complete demo report.
- 10 room themes with CC0 assets from Poly Haven.
- Editor in the browser: names, rooms, dashboards, themes, arrangement, guided tour, export
  review. Edits survive analysis reruns.
- Exports: one offline HTML file, static site, PDF, PowerPoint, GLB, USDZ, tour video.
- Flat view for phones and screen readers (WCAG 2.2 AA checked).
- Optional self-hosted hub: single sign-on, permissions, revisions, comments, live follow.
