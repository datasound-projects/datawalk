# Changelog

## Unreleased

- Guided tours walk like a visitor: to a stop in another room, the camera walks to the door
  and in through the next room's door (through up to two rooms in between) instead of
  cutting. Displays are framed at a reading distance with the room around them (about 55 %
  of the view's height, from a little to one side) instead of filling the screen. The AI
  guide enters each room with an introduction that names it and what comes there ("And now
  let's take a look at “Model Evaluation”: ..."), and speaks only once the camera stands at
  the stop.

- AI guide: **X** opens and closes its panel, also while you walk or while it speaks. The
  mouse is free for the panel without the pause menu, and X again gives it back to the walk.
  Keys typed into a text field (a question to the guide) no longer walk.

- The AI guide answers questions from facts that DataWalk computes from the report (changes,
  highs and lows with dates, falls from a peak, yearly moves, rankings) and from expert rules
  that interpret them (an AUC near 0.50 is chance; a 41% fall is severe). The local model
  only puts them into words, and every number is checked. Answers show a caveat and the facts
  behind them; follow-up questions work; dates outside the data, advice, causes, and
  forecasts are recognized by DataWalk. Without a model, the facts answer directly. Measured
  on 92 questions (`tests/guide_eval.py`), 91 answers pass, against 53 before.

- The README's install section says in three commands how to add the AI guide. The guide's
  Kokoro voice files now download on first use (SHA-256 checked); no manual download.

- One command installs DataWalk from GitHub, and one updates it:
  `uv tool install "datawalk[all] @ git+https://github.com/datasound-projects/datawalk"` and
  `uv tool upgrade datawalk`. uv builds the viewer with its own Node.js; nothing else to
  install. `uv sync` in a clone works the same way. The README is shorter.

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
