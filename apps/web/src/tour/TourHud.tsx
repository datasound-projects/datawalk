import { useEffect } from 'react'
import { t } from '../i18n'
import type { Report } from '../state/schema'
import { useViewerPick } from '../state/store'
import { DEFAULT_DURATION, inspectStop, next, openPresenter, prev, stopTour, tourStops } from './tour'

/** Presentation overlay: the stop title and position, and the keys. Kiosk mode advances itself. */
export function TourHud({ report }: { report: Report }) {
  const { stopIndex, kiosk, overlay } = useViewerPick('stopIndex', 'kiosk', 'overlay')
  const stops = tourStops(report)
  const stop = stops[stopIndex]

  useEffect(() => {
    if (!kiosk || !stop || overlay !== null) return
    const t = setTimeout(next, (stop.stop.duration ?? DEFAULT_DURATION) * 1000)
    return () => clearTimeout(t)
  }, [kiosk, stop, overlay])

  if (!stop || overlay !== null) return null
  return (
    <>
      <div className="tour-title" role="status" aria-live="polite">
        <span className="muted">
          {stopIndex + 1} / {stops.length}
        </span>
        <strong>{stop.title}</strong>
      </div>
      {!kiosk && (
        <div className="hud-help hud-buttons">
          {/* Buttons too: touch screens have no keys. */}
          <button onClick={next}>
            <kbd>→</kbd> {t('tourHud.next')}
          </button>
          <button onClick={prev}>
            <kbd>←</kbd> {t('tourHud.back')}
          </button>
          <button onClick={inspectStop}>
            <kbd>E</kbd> {t('tourHud.inspect')}
          </button>
          <button onClick={openPresenter}>
            <kbd>P</kbd> {t('tourHud.presenter')}
          </button>
          <button onClick={stopTour}>
            <kbd>Esc</kbd> {t('tourHud.end')}
          </button>
        </div>
      )}
    </>
  )
}
