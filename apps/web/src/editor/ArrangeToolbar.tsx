import { useState } from 'react'
import { rich, t } from '../i18n'
import { displayName, type Report } from '../state/schema'
import { useViewer } from '../state/store'
import { arrange, moveBy, resizeBy, select, toNextWall } from './arrangeOps'

export function exitArrange() {
  useViewer.getState().set({ arranging: false, selectedId: null, drag: null })
  useViewer.getState().setOverlay('editor')
}

/** Controls for arrange mode, shown over the room. */
export function ArrangeToolbar({ report }: { report: Report }) {
  const s = useViewer()
  // The room's placements when arranging began: Cancel restores them (history can be full).
  const [start] = useState(() => {
    const st = useViewer.getState()
    const r = st.report?.rooms.find((x) => x.id === st.roomId)
    return r ? { roomId: r.id, placements: JSON.stringify(r.placements) } : null
  })
  const ri = report.rooms.findIndex((r) => r.id === s.roomId)
  const room = report.rooms[ri]
  const id = s.selectedId
  const placement = id ? room?.placements[id] : undefined
  const v = report.visualizations.find((x) => x.id === id)
  const name = v ? displayName(v) : report.dashboards.find((d) => d.id === id)?.name
  const isWall = !(placement?.wall === 'floor' || (v?.source.library === 'plotly' && ['scatter3d', 'surface'].includes(v.source.chart_type)))
  const cancel = () => {
    const now = useViewer.getState().report?.rooms.find((r) => r.id === start?.roomId)
    if (start && now && JSON.stringify(now.placements) !== start.placements)
      useViewer.getState().edit((d) => {
        d.rooms.find((r) => r.id === start.roomId)!.placements = JSON.parse(start.placements)
      })
    exitArrange()
  }
  return (
    <div className="arrange-bar" role="toolbar" aria-label={t('arrange.label')}>
      <p>
        <strong>{t('arrange.title', { room: room?.name ?? '' })}</strong> {t('arrange.help')}
      </p>
      <p className="muted keys">
        {rich('arrange.keys', {
          select: (
            <>
              <kbd>[</kbd> <kbd>]</kbd>
            </>
          ),
          alt: <kbd>Alt</kbd>,
          shift: <kbd>Shift</kbd>,
          size: (
            <>
              <kbd>-</kbd> <kbd>=</kbd>
            </>
          ),
          wall: <kbd>.</kbd>,
        })}
      </p>
      {id && room && (
        <div className="row">
          <span>
            <strong>{name}</strong>{' '}
            <span className="muted">
              {placement
                ? [
                    placement.wall === 'floor'
                      ? t('arrange.onFloor')
                      : t('arrange.onWall', { wall: t(`wall.${placement.wall}`), width: placement.width.toFixed(2) }),
                    placement.locked && t('arrange.locked'),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('arrange.automatic')}
            </span>
          </span>
          <button
            disabled={!placement}
            onClick={() => s.edit((r) => void (r.rooms[ri].placements[id].locked = !placement!.locked))}
          >
            {placement?.locked ? t('arrange.unlock') : t('arrange.lock')}
          </button>
          <button disabled={!placement} onClick={() => s.edit((r) => void delete r.rooms[ri].placements[id])}>
            {t('arrange.automaticButton')}
          </button>
        </div>
      )}
      {id && (
        <div className="row" aria-label={t('arrange.moveSelected')}>
          <button aria-label={t('arrange.selectPrevious')} onClick={() => select(-1)}>‹</button>
          <button aria-label={t('arrange.selectNext')} onClick={() => select(1)}>›</button>
          <button aria-label={t('arrange.moveLeft')} onClick={() => arrange((l, i) => moveBy(l, i, isWall ? -0.1 : -0.25, 0))}>←</button>
          <button aria-label={t('arrange.moveRight')} onClick={() => arrange((l, i) => moveBy(l, i, isWall ? 0.1 : 0.25, 0))}>→</button>
          <button aria-label={isWall ? t('common.moveUp') : t('arrange.moveBack')} onClick={() => arrange((l, i) => moveBy(l, i, 0, isWall ? 0.1 : -0.25))}>↑</button>
          <button aria-label={isWall ? t('common.moveDown') : t('arrange.moveForward')} onClick={() => arrange((l, i) => moveBy(l, i, 0, isWall ? -0.1 : 0.25))}>↓</button>
          {isWall && (
            <>
              <button onClick={() => arrange((l, i) => resizeBy(l, i, 1 / 1.1))}>{t('arrange.smaller')}</button>
              <button onClick={() => arrange((l, i) => resizeBy(l, i, 1.1))}>{t('arrange.larger')}</button>
              <button onClick={() => arrange(toNextWall)}>{t('arrange.nextWall')}</button>
            </>
          )}
        </div>
      )}
      {!id && (
        <div className="row">
          <button onClick={() => select(1)}>{t('arrange.selectFirst')}</button>
        </div>
      )}
      {s.drag && !s.drag.valid && <p className="warn">{t('arrange.overlap')}</p>}
      {s.arrangeMessage && (
        <p className="warn" role="status">
          {s.arrangeMessage}
        </p>
      )}
      <div className="row">
        <button onClick={s.undo} disabled={!s.past.length}>
          {t('common.undo')}
        </button>
        <button onClick={s.redo} disabled={!s.future.length}>
          {t('common.redo')}
        </button>
        <button onClick={cancel}>{t('common.cancel')}</button>
        <button className="primary" onClick={exitArrange}>
          {t('arrange.done')}
        </button>
      </div>
    </div>
  )
}
