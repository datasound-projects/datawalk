# AI guide

The AI guide is a small animated presenter in the bottom-right corner of the viewer. It plans
a short presentation of your report, moves the camera from stop to stop, explains each stop
aloud, and answers questions about the report.

The guide is **optional** and **local**. It is off until you start DataWalk with `--guide`.
A language model on your computer writes the text. Nothing leaves your computer.

## Quick start

1. Install [Ollama](https://ollama.com) and get the model (2.8 GB):

   ```bash
   ollama pull nemotron-3-nano:4b
   ```

2. Start Ollama (the desktop app does this for you):

   ```bash
   ollama serve
   ```

3. Open a report with the guide:

   ```bash
   datawalk demo --guide
   ```

   Or `datawalk open report.dwk --guide`, or `report.show(guide=True)` in Python.

4. Click the avatar in the bottom-right corner. Choose 3, 5, or 10 minutes and click
   **Present**.

`datawalk doctor` checks the model, the voice, and Audio2Face-3D.

## Components

Each component is optional. Without one, the guide uses the next best thing.

| Component | Gives | Without it |
|---|---|---|
| Ollama with `nemotron-3-nano:4b` (NVIDIA Open Model License) | Plans and answers | The guide presents with the report's own text (speaker notes, findings, values). Questions show a clear message |
| Kokoro-82M voice (`datawalk[voice]`, about 120 MB of model files, Apache-2.0 weights) | A natural voice; the mouth follows the real audio | The browser's own voices speak (local voices first). Without any voice, captions show for their reading time |
| NVIDIA Audio2Face-3D (Linux or Windows, NVIDIA GPU) | Facial animation from the speech audio | The mouth follows the loudness of the audio, or the words of the browser voice |
| On-device speech recognition (Chrome 139 or later) | Spoken questions | Type the questions. The microphone shows only where the browser recognizes speech on the computer |

Measured on an Apple M2 (16 GB), no NVIDIA GPU:

| Measurement | Result |
|---|---|
| A 3-minute plan of the demo report | 16 to 60 s (the model writes about 600 words) |
| An answer to a question | about 10 to 25 s |
| Kokoro: one sentence of 3 s audio | 2 s (faster than real time; the next sentence loads while one plays) |
| Frame rate in a room, with and without the guide | 60 fps (display limit) |
| Guide code | 21 kB (7.6 kB compressed), loaded only with `--guide` |

## Present

- **Present** makes a plan (or uses the plan that you have) and starts. For each stop the
  camera moves, stops, and then the guide speaks. When the guide stops speaking, the camera
  moves to the next stop. Each step waits for an event, not a timer.
- While the guide presents, the panel closes. A compact toolbar stays next to the captions:
  **Pause** or **Resume**, **Ask**, **Stop**, **Mute**.
- The clicker keys still work: Page Down, Page Up, the arrow keys, Home, End. The guide
  stops speaking at once and explains the stop that you select. **Esc** ends the
  presentation.
- **Mute** silences the voice. The captions, the mouth, and the timing stay the same.
- **Pause** keeps the place: **Resume** repeats the sentence that was interrupted.

## Ask questions

Type a question, or click **Speak** where the microphone is available. Examples:

- "Explain this chart" (the chart on screen, or the chart in the inspector)
- "What changed?"
- "Show the best-performing model"

A question pauses the presentation. The answer shows:

- the answer (facts from the report),
- an **Interpretation** when the model adds one (what the facts may mean),
- the **Evidence**: links to the charts that support the answer.

The model can propose one of five actions: go to a stop, inspect a chart, the next stop,
pause, resume. DataWalk checks the action and runs it with its own tour engine and inspector.
When the answer shows a chart or a stop, the presentation stays paused; click **Resume** to
go on. After an answer that shows nothing new, the presentation goes on by itself.

## Review and edit the plan

The **Plan** tab shows each stop and its narration.

- Edit the narration. The guide speaks your text.
- **Present from here** starts at a stop.
- **Make a new plan** asks the model again.
- In the editor, **Use as the report tour** copies the stops and the narration into the
  report's tour (speaker notes). Save the report to keep them: the presenter view, the
  PowerPoint export, and the tour video use them.

Plans are kept for each revision of the report. A saved change makes a new plan.

## How the guide stays with the facts

The model proposes; DataWalk checks:

- **Stops.** Each stop must be a room, chart, or dashboard of the report. Unknown and
  repeated stops are removed. Charts that are only a picture (no data and no text) are not
  stops. The plan goes room by room in the report's order.
- **Numbers.** Each sentence with a number must find that number in the data of its own stop
  (or of the charts that the answer cites). Rounding, a missing sign, and percentages of
  fractions count as the same number (0.6123 can be "0.61"; -0.129 can be "12.9%"). Other
  sentences are removed, and the guide says how many. A stop without supported text uses the
  report's own words.
- **Actions.** Only the five actions, and only with stops and charts that exist.
- **Report text is data.** Chart titles, notes, and notebook text can contain instructions.
  They reach the model inside a data block, and the model is told to ignore instructions in
  it. Nothing that the model returns runs code.

**Limitation.** The check finds numbers that are not in the data. It cannot find every wrong
statement: a small model can put a correct number in a wrong sentence. Review the plan before
you present it to an audience.

## Privacy and security

- Off by default. Without `--guide`, the server has no guide routes and the viewer loads no
  guide code.
- The model, the voice, and Audio2Face-3D run on your computer. DataWalk connects only to
  addresses on this computer (`127.0.0.1`, `localhost`). To use an Ollama server on another
  computer of your network, set `DATAWALK_GUIDE_ALLOW_REMOTE=1`: the report data then goes to
  that computer.
- The guide routes accept only JSON from the viewer's own page: a website in another tab
  cannot start the model.
- The microphone works only with on-device recognition. No audio goes to a cloud service.
- Exports (HTML file, static site, PDF, PowerPoint, video) contain no guide code. The Content
  Security Policy of the viewer and of the exports does not change.
- The hub does not offer the guide.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATAWALK_OLLAMA_URL` | `http://127.0.0.1:11434` | The Ollama server |
| `DATAWALK_GUIDE_MODEL` | `nemotron-3-nano:4b` | Any Ollama model with structured output |
| `DATAWALK_GUIDE_ALLOW_REMOTE` | (not set) | `1` permits an Ollama or Audio2Face address on another computer |
| `DATAWALK_KOKORO_DIR` | `~/.cache/datawalk/kokoro` | The folder with the Kokoro model files |
| `DATAWALK_KOKORO_VOICE` | `af_heart` | A Kokoro v1.0 voice |
| `DATAWALK_A2F_URL` | (not set) | The local Audio2Face-3D bridge |

## Voice: Kokoro-82M

```bash
pip install "datawalk[voice]"
```

With `uv tool`, add `voice` to the extras of your install command. Then get the model files
(about 120 MB):

```bash
mkdir -p ~/.cache/datawalk/kokoro && cd ~/.cache/datawalk/kokoro
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

SHA-256 of these files:

```text
6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb  kokoro-v1.0.int8.onnx
bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  voices-v1.0.bin
```

`kokoro-v1.0.onnx` (325 MB) also works and sounds a little better.

**Licenses.** The Kokoro weights are Apache-2.0 and kokoro-onnx is MIT. kokoro-onnx uses
phonemizer and espeak-ng, which are GPL-3.0. For this reason `voice` is not part of the `all`
extra, and DataWalk never bundles these packages or the model files.

**Languages.** Kokoro v1.0 has no German voice. With the German interface, the guide speaks
with the browser's German voice.

## Facial animation: NVIDIA Audio2Face-3D

> **Status: not verified on NVIDIA hardware.** The adapter, the frame checks, and the
> avatar's use of the frames are tested with a stand-in bridge. No computer with an NVIDIA GPU
> was available. Without Audio2Face-3D the avatar uses its lip sync.

The [Audio2Face-3D SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK) is a C++/CUDA library
for Linux and Windows. It needs an NVIDIA GPU, CUDA 12.8 or later (below 13.0), and
TensorRT 10.13 or later (below 11.0). It does not run on macOS. Its models come from the
[Audio2Face-3D collection](https://huggingface.co/collections/nvidia/audio2face-3d-6865d22d6daec4ac85887b17)
on Hugging Face; the Audio2Emotion models need a license agreement on Hugging Face. Read the
license of each model before you use it.

DataWalk does not link the SDK and does not include its binaries or models. A separate local
process (the bridge) runs the SDK. Build it with the SDK's C++ API (see its
`sample-a2f-executor`). It must answer:

| Request | Answer |
|---|---|
| `GET /health` | `200` when the SDK and the models are loaded |
| `POST /animate` with a WAV file (mono, 16-bit, 24 kHz) | `200` with `{"fps": 30, "names": ["jawOpen", ...], "frames": [[0.12, ...], ...]}`: ARKit blendshape names, one row of weights (0 to 1) per frame |

Then set `DATAWALK_A2F_URL=http://127.0.0.1:<port>` and run `datawalk doctor`.

DataWalk checks each answer: a frame rate from 1 to 120, at most 64 names, at most one second
of frames more than the audio, and weights limited to 0 to 1. If the bridge fails, the speech
goes on and the lip sync moves the mouth. The avatar uses `jawOpen`, `mouthFunnel`,
`mouthSmileLeft`, `mouthSmileRight`, `browInnerUp`, `eyeBlinkLeft`, and `eyeBlinkRight`, and
plays the frames on the clock of the audio that plays, so the face stays in time and stops
when the speech stops.

## Troubleshooting

| You see | Do this |
|---|---|
| "Cannot reach Ollama at http://127.0.0.1:11434" | Start Ollama (`ollama serve`, or the desktop app) |
| "The model nemotron-3-nano:4b is not installed" | `ollama pull nemotron-3-nano:4b` |
| The first plan takes long | The model loads into memory first. DataWalk loads it when the server starts; later plans and answers are faster |
| "No local model. The guide uses the report text." | The guide presents with your report's text. Start Ollama and reload the page |
| No microphone button, or "not available for this language" | Use Chrome 139 or later with on-device speech recognition, or type the question |
| No sound | Check **Mute** and the system volume. Without a voice, the guide shows captions |
| The guide does not appear | Start DataWalk with `--guide`. Exports and the hub have no guide |

## Limitations

- The presenter view (second window) shows the report's tour, not the guide's plan.
- The guide answers one question or makes one plan at a time.
- A small local model is fast and private, but its plans and answers are simpler than those
  of large models. Review the plan before you present it.
- Kokoro v1.0 speaks English only (German uses the browser voice).
- Audio2Face-3D is not verified on NVIDIA hardware (see above).
