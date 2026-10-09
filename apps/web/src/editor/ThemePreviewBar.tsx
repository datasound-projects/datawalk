import { t } from '../i18n'
import type { Report } from '../state/schema'
import { useViewer } from '../state/store'
import { THEME_INFO } from '../themes/themes'
import { applyTheme } from './EditorPanel'

/** Shown over the room while the theme picker previews a theme. */
export function ThemePreviewBar({ report }: { report: Report }) {
  const { previewTheme, set, setOverlay } = useViewer()
  if (!previewTheme || document.body.classList.contains('shot')) return null
  const room = report.rooms.find((r) => r.id === previewTheme.roomId)
  const back = () => {
    set({ previewTheme: null })
    setOverlay('editor')
  }
  return (
    <div className="arrange-bar" role="toolbar" aria-label={t('themePreview.label')}>
      <p>
        <strong>{t('themePreview.title', { theme: THEME_INFO[previewTheme.theme].name })}</strong>{' '}
        <span className="muted">
          {room ? t('themePreview.forRoom', { room: room.name }) : t('themePreview.forReport')} · {t('themePreview.help')}
        </span>
      </p>
      <div className="row">
        <button onClick={back}>{t('common.cancel')}</button>
        <button
          className="primary"
          onClick={async () => {
            if (await applyTheme(report, previewTheme.roomId, previewTheme.theme)) back()
          }}
        >
          {t('themePreview.apply')}
        </button>
      </div>
    </div>
  )
}
