// Spoken questions, recognized on this computer only. Browsers send microphone audio to a cloud
// service unless `processLocally` is set; DataWalk offers the microphone only where the browser
// can recognize speech on the device (SpeechRecognition.available, Chrome 139 and later).

interface Recognition {
  lang: string
  interimResults: boolean
  processLocally: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

interface RecognitionClass {
  new (): Recognition
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>
}

const Recognizer = (globalThis as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: RecognitionClass }).webkitSpeechRecognition

/** The browser can promise on-device recognition (no cloud service). */
export const micSupported = !!Recognizer?.available

let active: Recognition | null = null

/** Listen for one question. onText gets the words while the visitor speaks; the promise
 *  resolves with the final text (empty when nothing was heard). */
export async function listen(lang: string, onText: (text: string) => void): Promise<string> {
  if (!Recognizer?.available) throw new Error('unsupported')
  const options = { langs: [lang === 'de' ? 'de-DE' : 'en-US'], processLocally: true }
  let state = await Recognizer.available(options)
  if ((state === 'downloadable' || state === 'downloading') && Recognizer.install) state = (await Recognizer.install(options)) ? 'available' : state
  if (state !== 'available') throw new Error('unavailable')
  active?.stop()
  const r = (active = new Recognizer())
  r.lang = options.langs[0]
  r.processLocally = true
  r.interimResults = true
  let text = ''
  return new Promise((resolve, reject) => {
    r.onresult = (e) => {
      text = Array.from(e.results, (alt) => alt[0]?.transcript ?? '').join('')
      onText(text)
    }
    r.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? undefined : reject(new Error(e.error)))
    r.onend = () => {
      if (active === r) active = null
      resolve(text.trim())
    }
    r.start()
  })
}

export function stopListening() {
  active?.stop()
}
