import { useEffect } from 'react'
import type { Quality } from '../app/quality'
import { lockPointer } from '../navigation/input'
import { displayName, type Report, type Room } from '../state/schema'
import { brandLogoUrl } from '../app/api'
import { LANGUAGES, locale, plural, rich, setLocale, t } from '../i18n'
import { canEdit, roomTheme, setFlat, touchOnly, useViewer, useViewerPick } from '../state/store'
import { loadedTheme } from '../themes/load'
import { startTour } from '../tour/tour'

const TUTORIAL_KEY = 'datawalk.tutorial-seen'

function tutorialSeen() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1'
  } catch {
    return false
  }
}

export function walk() {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1')
  } catch {
    /* storage unavailable: show the tutorial again next time */
  }
  useViewer.getState().setOverlay(null)
  lockPointer()
}

// Key names stay as printed on keyboards; words go through the catalog.
const controls = (): [string, string][] => [
  ['W A S D', t('controls.walk')],
  [t('controls.key.mouse'), t('controls.look')],
  ['Shift', t('controls.faster')],
  [t('controls.key.click'), t('controls.inspect')],
  ['M', t('controls.map')],
  ['Tab', t('controls.rooms')],
  ['Esc', t('controls.pause')],
  [t('controls.key.doors'), t('controls.nextRoom')],
  ['Page Down', t('controls.present')],
]

/** Opening screen and pause menu. */
/** The classification label ("Confidential"): in every view, and on every printed page. */
export function Classification({ report }: { report: Report }) {
  const label = report.classification
  useEffect(() => {
    document.body.classList.toggle('classified', !!label) // the views start below the banner
    return () => document.body.classList.remove('classified')
  }, [label])
  if (!report.classification) return null
  return (
    <div className="classification-tag" role="note" aria-label={t('classification.label', { label: report.classification })}>
      {report.classification}
    </div>
  )
}

/** The customer's logo and name, when the report has a brand. */
export function BrandMark({ report }: { report: Report }) {
  const b = report.brand
  if (!b || (!b.has_logo && !b.name)) return null
  return (
    <div className="brand-mark">
      {b.has_logo && <img src={brandLogoUrl()} alt={b.name ? t('brand.logoOf', { name: b.name }) : t('brand.logo')} />}
      {b.name && <span>{b.name}</span>}
    </div>
  )
}

/** Exported copies say which revision they show, when they were made, and their content hash. */
function ExportStamp() {
  const e = useViewer((s) => s.exportInfo)
  if (!e) return null
  return (
    <p className="export-stamp muted">
      {rich('export.stamp', {
        revision: e.revision,
        date: new Date(e.exported_at).toLocaleString(),
        hash: <code title={e.hash}>{e.hash.slice(0, 19)}</code>,
      })}
    </p>
  )
}

export function Lobby({ report }: { report: Report }) {
  const s = useViewer()
  const room = report.rooms.find((r) => r.id === s.roomId)
  const first = !tutorialSeen()
  return (
    <div className="overlay lobby">
      <div className="card">
        <BrandMark report={report} />
        <p className="eyebrow">{t('lobby.eyebrow')}</p>
        <h1>{report.name}</h1>
        {report.description && <p>{report.description}</p>}
        {room ? (
          <>
            <p className="muted">
              {plural('lobby.rooms', report.rooms.length)} · {rich('lobby.nowIn', { room: <strong>{room.name}</strong> })}
            </p>
            <div className="row">
              <button className="primary" onClick={walk} autoFocus>
                {s.started ? t('lobby.resume') : t('lobby.enter')}
              </button>
              {canEdit(s) && <button onClick={() => s.setOverlay('editor')}>{t('lobby.edit')}</button>}
              <button onClick={() => startTour(0)} title={t('lobby.presentTitle')}>
                {t('lobby.present')}
              </button>
              <button onClick={() => setFlat(true)}>{t('lobby.flat')}</button>
              {s.editToken && s.preview && (
                <button onClick={() => s.set({ preview: false })}>{t('lobby.exitPreview')}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <p>{t('lobby.noRooms')}</p>
            {canEdit(s) && <button onClick={() => s.setOverlay('editor')}>{t('lobby.edit')}</button>}
          </>
        )}
        {touchOnly() ? (
          <p className="touch-help">{t('lobby.touch')}</p>
        ) : (
          <dl className={`controls ${first ? 'tutorial' : ''}`}>
            {controls().map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ExportStamp />
        <div className="settings">
          <label className="check">
            <input
              type="checkbox"
              checked={s.screenShare}
              onChange={(e) => {
                s.set({ screenShare: e.target.checked })
                try {
                  localStorage.setItem('datawalk.screenshare', e.target.checked ? '1' : '0')
                } catch {
                  /* storage unavailable */
                }
              }}
            />
            {t('lobby.screenShare')}
          </label>
          <label>
            {t('lobby.quality')}
            <select value={s.quality} onChange={(e) => s.set({ quality: e.target.value as Quality })}>
              {(['low', 'medium', 'high'] as const).map((q) => (
                <option key={q} value={q}>
                  {q === s.gpu.tier ? t('lobby.recommended', { quality: t(`quality.${q}`) }) : t(`quality.${q}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('lobby.language')}
            <select
              value={s.lang}
              onChange={(e) => {
                setLocale(e.target.value)
                s.set({ lang: locale() })
              }}
            >
              {Object.entries(LANGUAGES).map(([id, name]) => (
                <option key={id} value={id} lang={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('lobby.speed')}
            <input type="range" min={1} max={4} step={0.1} value={s.speed} onChange={(e) => s.set({ speed: +e.target.value })} />
          </label>
          <label>
            {t('lobby.sensitivity')}
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={s.sensitivity}
              onChange={(e) => s.set({ sensitivity: +e.target.value })}
            />
          </label>
        </div>
        {room && <RoomCredits report={report} room={room} />}
        <p className="slogan muted">
          <strong>DataWalk</strong> · {t('brand.slogan')}
        </p>
      </div>
    </div>
  )
}

/** The authors of the room's 3D assets (CC0 from Poly Haven; credited as a courtesy). */
function RoomCredits({ report, room }: { report: Report; room: Room }) {
  const bundle = loadedTheme(roomTheme(report, room, null))
  if (!bundle) return null
  const { theme, room: spec, library } = bundle
  const ids = new Set<string>([
    theme.lighting.environment,
    ...(theme.lighting.view ? [theme.lighting.view] : []),
    ...Object.values(theme.surfaces).flatMap((x) => (x && typeof x === 'object' && 'material' in x && x.material ? [x.material] : [])),
    ...spec.furniture.map((f) => f.model),
    ...(spec.pendants ? [spec.pendants.model] : []),
  ])
  const credits = [...ids].flatMap((id) => (library.credits[id] ? [library.credits[id]] : []))
  if (!credits.length) return null
  return (
    <details className="credits">
      <summary>{t('credits.title')}</summary>
      <p className="muted">{t('credits.intro')}</p>
      <ul>
        {credits.map((c) => (
          <li key={c.source}>
            <a href={c.source} target="_blank" rel="noopener noreferrer">
              {c.name}
            </a>{' '}
            <span className="muted">
              {c.authors.join(', ')} · {c.license}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Report navigator: jump to any room, or straight to any chart. */
export function Navigator({ report }: { report: Report }) {
  const { roomId, enterRoom, inspect } = useViewer()
  const byId = new Map(report.visualizations.map((v) => [v.id, v]))
  const chart = (roomIdOf: string, id: string) => {
    const v = byId.get(id)
    return (
      v?.status === 'active' && (
        <li key={id}>
          <button
            className="link"
            onClick={() => {
              enterRoom(roomIdOf)
              inspect(id)
            }}
          >
            {displayName(v)}
          </button>
        </li>
      )
    )
  }
  return (
    <div className="overlay navigator" role="dialog" aria-label={t('navigator.label')}>
      <div className="card wide">
        <h2>{report.name}</h2>
        <div className="rooms">
          {report.rooms.map((room) => (
            <section key={room.id} className={room.id === roomId ? 'current' : ''}>
              <button
                className="room"
                autoFocus={room.id === roomId}
                onClick={() => {
                  enterRoom(room.id)
                  walk()
                }}
              >
                {room.name}
                {room.id === roomId && <span className="muted"> {t('navigator.here')}</span>}
              </button>
              <ul>
                {room.items.map((id) => {
                  const d = report.dashboards.find((x) => x.id === id)
                  if (!d) return chart(room.id, id)
                  return (
                    <li key={id}>
                      <span className="muted">{d.name}</span>
                      <ul>{d.items.map((m) => chart(room.id, m))}</ul>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <p className="muted">{t('navigator.close')}</p>
      </div>
    </div>
  )
}

/** Minimal in-room overlay while walking. */
export function Hud({ report }: { report: Report }) {
  const { roomId, focusedId, pointInfo, overlay, arranging, previewTheme } = useViewerPick('roomId', 'focusedId', 'pointInfo', 'overlay', 'arranging', 'previewTheme')
  if (overlay !== null || arranging || previewTheme) return null
  const room = report.rooms.find((r) => r.id === roomId)
  const focused = report.visualizations.find((v) => v.id === focusedId)
  return (
    <>
      <div className="hud-title">
        <strong>{room?.name}</strong>
        <span>{report.name}</span>
      </div>
      <div className={`crosshair ${focused ? 'active' : ''}`} />
      {focused && (
        <div className="hud-hint">
          {pointInfo && <div className="point-info">{pointInfo}</div>}
          {/* Buttons too: touch screens have no keys. */}
          <button onClick={() => useViewer.getState().inspect(focused.id)}>
            <kbd>E</kbd> {rich('hud.inspect', { name: <strong>{displayName(focused)}</strong> })}
          </button>
        </div>
      )}
      <div className="hud-help hud-buttons">
        <button onClick={() => useViewer.getState().setOverlay('map')}>
          <kbd>M</kbd> {t('hud.map')}
        </button>
        <button onClick={() => useViewer.getState().setOverlay('navigator')}>
          <kbd>Tab</kbd> {t('hud.rooms')}
        </button>
        <button onClick={() => useViewer.getState().setOverlay('lobby')}>
          <kbd>Esc</kbd> {t('hud.pause')}
        </button>
      </div>
    </>
  )
}
