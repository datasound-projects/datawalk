# Contributing

## Set up

You need [uv](https://docs.astral.sh/uv/) and Node.js 22 or later. Users of the published
package do not need Node.js.

```bash
uv sync --all-packages --all-extras   # library, hub, every extra, and the dev tools
cd apps/web && npm ci                 # viewer
npm run build                         # the viewer (server/static) and the export viewer (server/viewer)
npx playwright install chromium firefox webkit   # browser engines for the end-to-end tests
```

## Run the viewer during development

1. Start a report server on the port that the Vite proxy expects:
   `uv run datawalk demo --port 8765 --no-browser` (or the script `examples/financial_research.py`)
2. In `apps/web`, run `npm run dev` and open the URL that Vite shows.

## Checks

Run all checks before you open a pull request. CI runs the same checks.

```bash
uv run ruff check . && uv run ruff format --check . && uv run pytest
cd apps/web && npm run lint && npm run build && npm test && npm run test:e2e
```

`npm run test:e2e` uses your installed Chrome for the Chromium projects, and Playwright's
Firefox and WebKit for the export projects. CI uses Playwright's browsers. The suite starts
its own servers: demo reports (`apps/web/e2e/serve.py`, test-only editor token `e2e-token`),
the notebook example, the other-sources example, and a hub (`apps/web/e2e/hub_serve.py`).

The AI guide's tests use stand-ins for the model and the voice (`e2e/guide_serve.py`). To
test with the real model too, run `ollama serve` and `DATAWALK_TEST_OLLAMA=1 uv run pytest
tests/test_guide.py`.

The Python tests include the hub (`packages/hub/tests`). Some tests need the web build and a
browser (PDF, world files, the CI recipe); they skip themselves without them.

## User interface text

Put every user-visible string in the message catalogs (`apps/web/src/i18n/`, and
`packages/hub/datawalk_hub/i18n.py` for the hub), in English and German. The tests check that
the catalogs have the same keys and placeholders. Write the text in ASD-STE100 Simplified
Technical English: short sentences, active voice, one instruction per sentence.

## The Python/TypeScript contract

`packages/python/datawalk/core/models.py` defines the report data.
`apps/web/src/state/schema.ts` validates the same data at runtime.

If you change a model:

1. Update both files.
2. Run `uv run datawalk schema packages/schema/generated/report.schema.json`.
3. Set the new field in `packages/schema/make_example.py`, then run
   `uv run python packages/schema/make_example.py`. `pytest` and `npm test` both check the
   generated fixture.

## Write an adapter

An adapter converts one kind of figure object. Subclass `datawalk.adapters.Adapter` and
implement `supports`, `extract_metadata`, `serialize` and `render_preview`. Then register it
in your package:

```toml
[project.entry-points."datawalk.adapters"]
mylib = "mypackage.datawalk_adapter:MyLibAdapter"
```

Rules:

- `supports` must not import your plotting library. Check `sys.modules` first.
- Return a payload only for data that you recover exactly. Otherwise return `None`.
- Add each piece of data that you cannot recover to `Source.limitations`.
