# Performance measurements

Measured with `node apps/web/scripts/perf.mjs` on 2026-10-08.

| | |
|---|---|
| Machine | Apple M2 (8 cores), 16 GB RAM, Darwin 25.6.0 |
| Browser | Chrome 154.0.8037.98 (headless), viewport 1920 x 1080 |
| GPU | ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version) |
| Report | Synthetic demo, first room: 5 charts and a 3-KPI dashboard |


| Theme | Quality | Load (ms) | FPS | Draw calls | Triangles | Textures | Geometries | JS heap (MB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| executive_office | low | 1307 | 59.9 | 107 | 306446 | 56 | 105 | 53 |
| executive_office | medium | 1038 | 60.0 | 107 | 306446 | 56 | 105 | 52 |
| executive_office | high | 1123 | 60.2 | 107 | 306446 | 56 | 105 | 57 |
| dark_gallery | low | 903 | 59.5 | 59 | 18571 | 29 | 93 | 35 |
| dark_gallery | medium | 877 | 60.3 | 59 | 18571 | 29 | 93 | 30 |
| dark_gallery | high | 877 | 60.3 | 59 | 18571 | 29 | 93 | 30 |
| museum_atrium | low | 1160 | 60.1 | 86 | 166408 | 25 | 80 | 39 |
| museum_atrium | medium | 1093 | 60.1 | 86 | 166408 | 25 | 80 | 39 |
| museum_atrium | high | 1034 | 60.1 | 86 | 166408 | 25 | 80 | 39 |
| data_command_center | low | 860 | 60.3 | 63 | 32008 | 29 | 86 | 36 |
| data_command_center | medium | 875 | 60.2 | 63 | 32008 | 29 | 86 | 32 |
| data_command_center | high | 880 | 60.3 | 63 | 32008 | 29 | 86 | 36 |

Load time: from navigation until the room draws its furniture and displays (theme assets
from the local server, no browser cache). FPS: frames in 8 s at a fixed view.

## Targets (from the plan)

- About 60 FPS at 1080p on a midrange discrete GPU (High).
- At least 30 FPS on an integrated GPU (Low).
- No GPU memory growth over repeated room changes: verified by `e2e/themes.spec.ts`.

## Large reports

Measured on 2026-10-09 on the same machine (Chrome 154, 1440 x 900). The report has 163
visualizations in 14 rooms: 12 rooms with 10 items each (Matplotlib lines, Plotly scatters
with 2,000 points, KPIs, tables), a room with 40 KPIs, and a room with a 200,000-row table
(10,000 rows kept), a Matplotlib line with 1,000,000 points (image only), and a Plotly chart
with 300,000 points.

| Measurement | Result |
|---|---|
| Build the report in Python | 3.7 s |
| Save the archive | 0.4 s (7.9 MB) |
| Export review, then the single HTML file | 0.2 s, then 0.3 s (29.6 MB) |
| Viewer: lobby ready | 0.45 s |
| Frame rate in each of the 14 rooms | 61 fps |
| Inspector: the 300,000-point Plotly chart | 0.28 s |
| Flat view: all 163 items ready | 3.9 s |
| The 29.6 MB HTML file from disk: first screen | 0.5 s, 0 network requests |
| JS heap after all rooms and the inspector | 144 MB |

The review warns about the 29.6 MB file: it is above the 20 MB that many e-mail services
accept.
