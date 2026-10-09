import { useState } from 'react'
import { itemKind } from '../layouts/items'
import { asset } from '../app/assets'
import { plural, rich, t } from '../i18n'
import { THEME_INFO, type ThemeId } from '../themes/themes'
import { displayName, type Report, type Room, THEMES } from '../state/schema'
import { isDirty, useViewer } from '../state/store'
import { EXPLANATION_LABELS, modeLabel } from '../viewer/Inspector'
import { addRoom, createDashboard, deleteRemoved, deleteRoom, moveItem, reorder, unassigned, ungroup } from './ops'
import { ExportTab } from './ExportTab'
import { Text } from './Text'
import { TourTab } from './TourTab'
import { applyPlacementChanges, planThemeChange } from './themeSwitch'

type Tab = 'report' | 'rooms' | 'charts' | 'dashboards' | 'themes' | 'tour' | 'export'
const TABS: Tab[] = ['report', 'rooms', 'charts', 'dashboards', 'themes', 'tour', 'export']

function itemLabel(r: Report, id: string) {
  const v = r.visualizations.find((x) => x.id === id)
  if (v) return { name: displayName(v), kind: t(`kind.${itemKind(v)}`) }
  return { name: r.dashboards.find((d) => d.id === id)?.name ?? '?', kind: t('kind.dashboard') }
}

export function EditorPanel({ report }: { report: Report }) {
  const s = useViewer()
  // In the store: the editor closes for theme previews and arranging, and reopens on the same tab.
  const tab = s.editorTab as Tab
  const setTab = (t: Tab) => s.set({ editorTab: t })
  const dirty = isDirty(s)
  return (
    <div className="overlay editor" role="dialog" aria-label={t('editor.label')}>
      <header className="editor-bar">
        <h2>{t('editor.title')}</h2>
        <div className="row">
          <button onClick={s.undo} disabled={!s.past.length} title={t('editor.undoTitle')}>
            {t('common.undo')}
          </button>
          <button onClick={s.redo} disabled={!s.future.length} title={t('editor.redoTitle')}>
            {t('common.redo')}
          </button>
          <button className="primary" onClick={s.save} disabled={!dirty || s.saving}>
            {s.saving ? t('editor.saving') : t('editor.save')}
          </button>
          <span className={s.saveError ? 'warn' : 'muted'} role="status">
            {s.saveError ??
              (dirty ? t('editor.unsaved') : s.savesTo ? t('editor.savedTo', { file: s.savesTo }) : t('editor.savedPython'))}
          </span>
        </div>
        <div className="row">
          <button
            onClick={() => {
              s.set({ preview: true })
              s.setOverlay('lobby')
            }}
          >
            {t('editor.previewStakeholder')}
          </button>
          <button onClick={() => s.setOverlay('lobby')}>{t('editor.close')}</button>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} autoFocus={tab === id}>
            {t(`editor.tab.${id}`)}
          </button>
        ))}
      </nav>
      {!s.savesTo && (
        <p className="notice editor-notice">
          {rich('editor.noFile', { code: <code>report.save(&quot;name.dwk&quot;)</code> })}
        </p>
      )}
      <main className="editor-body">
        {tab === 'report' && <ReportTab report={report} />}
        {tab === 'rooms' && <RoomsTab report={report} />}
        {tab === 'charts' && <ChartsTab report={report} />}
        {tab === 'dashboards' && <DashboardsTab report={report} />}
        {tab === 'themes' && <ThemesTab report={report} />}
        {tab === 'tour' && <TourTab report={report} />}
        {tab === 'export' && <ExportTab report={report} />}
      </main>
    </div>
  )
}

function ReportTab({ report }: { report: Report }) {
  const edit = useViewer((s) => s.edit)
  const labels = useViewer((s) => s.labels)
  return (
    <section className="panel">
      <Text label={t('report.name')} value={report.name} required onCommit={(v) => edit((r) => void (r.name = v))} />
      <Text label={t('common.description')} value={report.description} multiline onCommit={(v) => edit((r) => void (r.description = v))} />
      <Text label={t('report.author')} value={report.author} onCommit={(v) => edit((r) => void (r.author = v))} />
      <Text label={t('report.date')} value={report.date} placeholder="2026-10-01" onCommit={(v) => edit((r) => void (r.date = v))} />
      <Text label={t('report.cutoff')} value={report.data_cutoff} placeholder="2026-09-30" onCommit={(v) => edit((r) => void (r.data_cutoff = v))} />
      <label className="field">
        <span>{t('report.classification')}</span>
        <select value={report.classification} onChange={(e) => edit((r) => void (r.classification = e.target.value))}>
          <option value="">{t('report.none')}</option>
          {[...new Set([...labels, report.classification].filter(Boolean))].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        {t('report.stats', {
          rooms: report.rooms.length,
          visualizations: report.visualizations.filter((v) => v.status === 'active').length,
          dashboards: report.dashboards.length,
          revision: report.revision,
        })}
      </p>
    </section>
  )
}

function RoomsTab({ report }: { report: Report }) {
  const { edit, enterRoom, setOverlay, set } = useViewer()
  const [newRoom, setNewRoom] = useState('')
  const loose = unassigned(report)
  const removed = report.visualizations.filter((v) => v.status === 'removed')
  const arrange = (room: Room) => {
    enterRoom(room.id)
    set({ arranging: true, selectedId: null })
    setOverlay(null)
  }
  const moveSelect = (id: string, current: string | null) => (
    <select
      aria-label={t('rooms.moveTo')}
      value={current ?? ''}
      onChange={(e) => edit((r) => moveItem(r, id, e.target.value || null))}
    >
      <option value="">{t('rooms.unassigned')}</option>
      {report.rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  )
  return (
    <>
      {report.rooms.map((room, ri) => (
        <section key={room.id} className="panel">
          <div className="panel-head">
            <Text label={t('rooms.name', { n: ri + 1 })} value={room.name} required onCommit={(v) => edit((r) => void (r.rooms[ri].name = v))} />
            <div className="row">
              <button onClick={() => arrange(room)}>{t('rooms.arrange')}</button>
              {Object.keys(room.placements).length > 0 && (
                <button
                  onClick={() =>
                    confirm(t('rooms.confirmRestore', { room: room.name })) && edit((r) => void (r.rooms[ri].placements = {}))
                  }
                >
                  {t('rooms.restore')}
                </button>
              )}
              <button
                className="danger"
                onClick={() =>
                  confirm(t('rooms.confirmDelete', { room: room.name })) && edit((r) => deleteRoom(r, room.id))
                }
              >
                {t('rooms.delete')}
              </button>
            </div>
          </div>
          <Text label={t('common.description')} value={room.description} multiline onCommit={(v) => edit((r) => void (r.rooms[ri].description = v))} />
          <ol className="items">
            {room.items.map((id, i) => {
              const { name, kind } = itemLabel(report, id)
              return (
                <li key={id}>
                  <span className="kind">{kind}</span>
                  <span className="name">{name}</span>
                  {room.placements[id] && <span className="tag">{t(room.placements[id].locked ? 'rooms.manualLocked' : 'rooms.manual')}</span>}
                  <button aria-label={t('common.moveUpItem', { name })} disabled={i === 0} onClick={() => edit((r) => reorder(r, room.id, id, -1))}>
                    ↑
                  </button>
                  <button
                    aria-label={t('common.moveDownItem', { name })}
                    disabled={i === room.items.length - 1}
                    onClick={() => edit((r) => reorder(r, room.id, id, 1))}
                  >
                    ↓
                  </button>
                  {moveSelect(id, room.id)}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      <section className="panel row">
        <input aria-label={t('rooms.newName')} placeholder={t('rooms.newName')} value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
        <button
          disabled={!newRoom.trim()}
          onClick={() => {
            edit((r) => void addRoom(r, newRoom.trim()))
            setNewRoom('')
          }}
        >
          {t('rooms.add')}
        </button>
      </section>
      {loose.length > 0 && (
        <section className="panel">
          <h3>{t('rooms.unassigned')}</h3>
          <ol className="items">
            {loose.map((v) => (
              <li key={v.id}>
                <span className="kind">{t(`kind.${itemKind(v)}`)}</span>
                <span className="name">{displayName(v)}</span>
                {moveSelect(v.id, null)}
              </li>
            ))}
          </ol>
        </section>
      )}
      {removed.length > 0 && (
        <section className="panel">
          <h3>{t('rooms.removed')}</h3>
          <p className="muted">{t('rooms.removedHelp')}</p>
          <ol className="items">
            {removed.map((v) => (
              <li key={v.id}>
                <span className="name">{displayName(v)}</span>
                <code>{v.key}</code>
                <button
                  className="danger"
                  onClick={() =>
                    confirm(t('rooms.confirmDeleteRemoved', { name: displayName(v) })) && edit((r) => deleteRemoved(r, v.id))
                  }
                >
                  {t('rooms.deletePermanently')}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

function ChartsTab({ report }: { report: Report }) {
  const edit = useViewer((s) => s.edit)
  return (
    <>
      {report.visualizations.map((v, vi) => {
        const set = (change: (o: typeof v.overrides) => void) => edit((r) => change(r.visualizations[vi].overrides))
        const ex = v.overrides.explanation
        return (
          <details key={v.id} className="panel">
            <summary>
              <strong>{displayName(v)}</strong> <code>{v.key}</code>{' '}
              <span className="muted">
                {v.source.library} · {modeLabel(v)}
                {v.status === 'removed' && ` · ${t('charts.removed')}`}
              </span>
            </summary>
            <Text
              label={t('common.name')}
              value={v.overrides.name ?? ''}
              placeholder={t('charts.namePlaceholder', { name: v.source.default_name })}
              onCommit={(n) => set((o) => void (o.name = n.trim() || null))}
            />
            <Text label={t('common.description')} value={v.overrides.description} multiline onCommit={(d) => set((o) => void (o.description = d))} />
            <Text
              label={t('charts.findings')}
              value={ex.findings.join('\n')}
              multiline
              onCommit={(f) =>
                set(
                  (o) =>
                    void (o.explanation.findings = f
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean)),
                )
              }
            />
            <div className="grid2">
              {EXPLANATION_LABELS.map(([k, label]) => (
                <Text
                  key={k}
                  label={t(label)}
                  value={ex[k] as string}
                  multiline={k !== 'units' && k !== 'author'}
                  onCommit={(t) => set((o) => void ((o.explanation[k] as string) = t))}
                />
              ))}
            </div>
          </details>
        )
      })}
    </>
  )
}

function DashboardsTab({ report }: { report: Report }) {
  const edit = useViewer((s) => s.edit)
  const [roomId, setRoomId] = useState(report.rooms[0]?.id ?? '')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const room = report.rooms.find((r) => r.id === roomId)
  const candidates = (room?.items ?? [])
    .map((id) => report.visualizations.find((v) => v.id === id))
    .filter((v) => v && v.status === 'active' && itemKind(v) !== 'exhibit')
  const active = report.visualizations.filter((v) => v.status === 'active')
  return (
    <>
      {report.dashboards.map((d, di) => (
        <section key={d.id} className="panel">
          <div className="panel-head">
            <Text label={t('dashboards.name')} value={d.name} required onCommit={(v) => edit((r) => void (r.dashboards[di].name = v))} />
            <button onClick={() => edit((r) => ungroup(r, d.id))}>{t('dashboards.ungroup')}</button>
          </div>
          <Text label={t('common.description')} value={d.description} multiline onCommit={(v) => edit((r) => void (r.dashboards[di].description = v))} />
          <fieldset className="checks">
            <legend>{t('dashboards.charts')}</legend>
            {active.map((v) => (
              <label key={v.id}>
                <input
                  type="checkbox"
                  checked={d.items.includes(v.id)}
                  disabled={d.items.length === 1 && d.items.includes(v.id)}
                  onChange={(e) =>
                    edit((r) => {
                      const items = r.dashboards[di].items
                      r.dashboards[di].items = e.target.checked ? [...items, v.id] : items.filter((i) => i !== v.id)
                    })
                  }
                />
                {displayName(v)}
              </label>
            ))}
          </fieldset>
        </section>
      ))}
      <section className="panel">
        <h3>{t('dashboards.new')}</h3>
        <div className="row">
          <select aria-label={t('dashboards.room')} value={roomId} onChange={(e) => (setRoomId(e.target.value), setPicked([]))}>
            {report.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input aria-label={t('dashboards.name')} placeholder={t('dashboards.name')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="checks">
          <legend>{t('dashboards.pick')}</legend>
          {candidates.map((v) => (
            <label key={v!.id}>
              <input
                type="checkbox"
                checked={picked.includes(v!.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, v!.id] : picked.filter((i) => i !== v!.id))}
              />
              {displayName(v!)}
            </label>
          ))}
        </fieldset>
        <button
          disabled={!name.trim() || picked.length < 2}
          onClick={() => {
            edit((r) => void createDashboard(r, roomId, name.trim(), picked))
            setName('')
            setPicked([])
          }}
        >
          {t('dashboards.create')}
        </button>
      </section>
    </>
  )
}

/** Apply a theme to the report default (roomId null) or to one room, keeping manual placements
 *  where the new room allows them. Asks first when placements must move. */
export async function applyTheme(report: Report, roomId: string | null, theme: ThemeId | null) {
  const { edit } = useViewer.getState()
  const target = theme ?? report.theme
  // Rooms whose look changes: one room, or every room that uses the report default.
  const rooms = report.rooms.filter((r) => (roomId ? r.id === roomId : r.theme === null)).map((r) => r.id)
  const changes = await planThemeChange(report, rooms, target)
  if (changes.length) {
    const moved = changes.filter((c) => c.to).length
    const auto = changes.length - moved
    const msg = [
      plural('themes.noFit', changes.length, { theme: THEME_INFO[target].name }),
      moved && t('themes.willMove', { n: moved }),
      auto && t('themes.willAuto', { n: auto }),
      t('themes.confirmApply'),
    ]
      .filter(Boolean)
      .join(' ')
    if (!confirm(msg)) return false
  }
  edit((r) => {
    if (roomId) r.rooms.find((x) => x.id === roomId)!.theme = theme
    else r.theme = target
    applyPlacementChanges(r, changes)
  })
  return true
}

function ThemeCard({ id, active, onPreview, onApply }: { id: ThemeId; active: boolean; onPreview: () => void; onApply: () => void }) {
  return (
    <article className={active ? 'theme active' : 'theme'} aria-label={THEME_INFO[id].name}>
      <img src={asset(`themes/${id}/preview.jpg`)} alt={t('themes.roomAlt', { theme: THEME_INFO[id].name })} loading="lazy" />
      <strong>{THEME_INFO[id].name}</strong>
      <span className="muted">{t(`theme.${id}`)}</span>
      <div className="row">
        <button onClick={onPreview}>{t('themes.preview')}</button>
        <button className={active ? '' : 'primary'} disabled={active} onClick={onApply}>
          {active ? t('themes.applied') : t('themes.apply')}
        </button>
      </div>
    </article>
  )
}

function ThemesTab({ report }: { report: Report }) {
  const { roomId, enterRoom, set, setOverlay } = useViewer()
  const [scope, setScope] = useState<string>('report') // 'report' or a room id
  const room = report.rooms.find((r) => r.id === scope)
  const current = room ? (room.theme ?? report.theme) : report.theme
  const preview = (theme: ThemeId) => {
    // Show it in a room that uses this scope: the chosen room, else the current room.
    const show = room?.id ?? (report.rooms.find((r) => r.id === roomId && r.theme === null) ?? report.rooms.find((r) => r.theme === null))?.id
    if (!show) return
    enterRoom(show)
    set({ previewTheme: { roomId: room?.id ?? null, theme } })
    setOverlay(null)
  }
  return (
    <>
      <section className="panel">
        <label className="field inline">
          <span>{t('themes.scopeLabel')}</span>
          <select aria-label={t('themes.scope')} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="report">{t('themes.wholeReport')}</option>
            {report.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {t('common.roomOption', { room: r.name })}
                {r.theme ? ` (${THEME_INFO[r.theme].name})` : ''}
              </option>
            ))}
          </select>
        </label>
        {room?.theme && (
          <button onClick={() => applyTheme(report, room.id, null)}>{t('themes.useReport', { theme: THEME_INFO[report.theme].name })}</button>
        )}
        <div className="themes">
          {THEMES.map((id) => (
            <ThemeCard key={id} id={id} active={current === id} onPreview={() => preview(id)} onApply={() => applyTheme(report, room?.id ?? null, id)} />
          ))}
        </div>
      </section>
    </>
  )
}
