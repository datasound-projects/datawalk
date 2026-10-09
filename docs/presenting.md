# Presenting

## Themes

A theme gives the rooms their architecture, materials, light, and furniture. Choose one for
the report, and optionally another one for a room, in Python or in the editor (**Themes**
tab, with a preview).

```python
report = dw.Report("Quarterly Review", theme="dark_gallery")   # or theme="Dark Gallery"
```

| Theme id | Name | Character |
|---|---|---|
| `executive_office` | Executive Office | Wood, leather, and city views, for board-level reviews (the default) |
| `home_office` | Home Office | A warm, informal workspace with shelves and daylight |
| `light_gallery` | Light Gallery | White walls and even daylight; the charts come first |
| `dark_gallery` | Dark Gallery | Dark walls and spotlights for high-contrast displays |
| `industrial_loft` | Industrial Loft | Brick, steel, and tall windows |
| `minimalist_studio` | Minimalist Studio | Plain surfaces and soft light, without distractions |
| `museum_atrium` | Museum Atrium | A tall space with skylights and exhibit plinths |
| `futuristic_lab` | Futuristic Lab | Clean lab surfaces and light strips |
| `metaverse_pavilion` | Metaverse Pavilion | An open glass pavilion under a stylized sky |
| `data_command_center` | Data Command Center | A dark control room with large display walls |

## Guided tour

The tour moves the camera from stop to stop, like a slide deck. Nobody needs to walk.

Without a tour, the default order applies: the summary room, then each room followed by
its charts in room order. Set a tour in Python or in the editor (**Tour** tab):

```python
report.set_tour(["revenue_kpi", "price", "Overview", "roc"])  # keys, dashboard names, room names
report.tour_stop("price").notes = "Volatility doubled in Q3."  # speaker notes
report.tour_stop("price").duration = 8  # seconds, for kiosk mode
```

A rerun keeps the tour that a person edited in the editor. Until then, the script's tour
applies.

| Input | Action |
|---|---|
| → / Space / Page Down | Next stop (Page Down in the lobby starts the tour) |
| ← / Page Up | Previous stop |
| Home / End | First / last stop |
| E or Enter | Open the inspector at the current stop |
| P | Open the presenter view |
| Esc | Leave the tour |

Presentation clickers send Page Up and Page Down. They work without configuration. The bar
at the bottom of the screen has the same actions as buttons, for a mouse or a touch screen
(for example a tablet in a client meeting).

The camera glides on a path inside the room, around furniture and exhibits, with
ease-in-out motion and a speed limit. It does not roll or bob. A stop in another room fades
in (0.45 s). With "reduce motion" set in the operating system, the camera cuts directly to
each stop. The target fills about 70 % of the viewport height.

**Presenter view.** Press P. A second window shows the speaker notes, the current and the
next stop, and a timer. The windows stay in step through `BroadcastChannel` (and directly,
for files opened from disk). Put the windows on two monitors. The clicker works in both
windows.

**Kiosk mode.** Open the report with `?kiosk`. The tour advances by the stop duration (10 s
by default) and starts again after the last stop. `?present` starts the tour without kiosk
mode.

**Screen-share mode.** For video calls without the hub: select **Screen-share mode** in the
lobby, or open the report with `?screenshare`. The camera moves more slowly, the text is
larger, and the key hints are hidden.

## Tour video

```bash
datawalk export report.dwk --video tour.mp4 --seconds 6
```

DataWalk records the tour in a headless browser at 1920 × 1080 (screen-share mode). Each
stop shows for its duration, or for `--seconds`. MP4 needs `ffmpeg`; without it, the result
is a WebM file. Recording needs `datawalk[pdf]` (Playwright) and Chrome or Chromium.

## Live follow (needs the hub)

On a [DataWalk Hub](hub.md), an owner or editor clicks **Present live**. Every attendee who
has the report open follows: each browser renders the same stop itself, at full quality.
Only the tour position and the camera pose travel over the network, never video.

- An attendee who walks (W, A, S, D, or an arrow key) breaks away and explores alone.
  **Follow** (or the F key) snaps back to the presenter's current position.
- The presenter sees how many attendees follow, and who is away.
- Attendees can ask a question on a chart (**Ask a question** in the inspector). The hub
  saves it as a comment on that chart.
