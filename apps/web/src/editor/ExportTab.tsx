import { useEffect, useState } from 'react'
import { type ExportOptions, type ExportReview, exportHtml, exportReview } from '../app/api'
import { rich, t } from '../i18n'
import type { Report } from '../state/schema'
import { isDirty, useViewer } from '../state/store'

const mb = (b: number) => `${(b / 2 ** 20).toFixed(1)} MB`
const kb = (b: number) => (b < 1024 ? '< 1 KB' : `${Math.round(b / 1024).toLocaleString()} KB`)

/** Export review: every export is a data release. The author sees, per chart, what leaves the
 *  machine, may reduce charts to their preview image, and confirms before the download. */
export function ExportTab({ report }: { report: Report }) {
  const s = useViewer()
  const token = s.editToken!
  const dirty = isDirty(s)
  const [options, setOptions] = useState<ExportOptions>({ preview_only: [], datasets: false, watermark: '' })
  const [review, setReview] = useState<ExportReview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState(false) // the review does not show the latest options yet

  useEffect(() => {
    // Wait for a pause in typing (the watermark): each review prepares the whole export.
    let live = true
    const timer = setTimeout(() => {
      exportReview(options, token).then(
        (r) => live && (setReview(r), setPending(false)),
        (e) => live && setStatus(String(e)),
      )
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [options, token, s.saved])

  // Any change to the options needs a new confirmation.
  const change = (o: Partial<ExportOptions>) => {
    setConfirmed(false)
    setPending(true)
    setStatus(null)
    setOptions({ ...options, ...o })
  }
  const togglePreview = (key: string, preview: boolean) =>
    change({ preview_only: preview ? [...options.preview_only, key] : options.preview_only.filter((k) => k !== key) })

  const download = async () => {
    setStatus(t('export.exporting'))
    try {
      const blob = await exportHtml(options, token)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${report.name.replace(/[^\w-]+/g, '_').slice(0, 80) || 'report'}.html`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      setStatus(t('export.downloaded', { file: a.download, size: mb(blob.size) }))
    } catch (e) {
      setStatus(String(e))
    }
  }

  const over = review?.total_bytes != null && review.total_bytes > review.budget_bytes
  return (
    <>
      <section className="panel">
        <h3>{t('export.title')}</h3>
        <p className="muted">{rich('export.intro', { command: <code>datawalk export report.dwk --site out/ --pdf</code> })}</p>
        {report.datasets.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={options.datasets} onChange={(e) => change({ datasets: e.target.checked })} />{' '}
            {t('export.includeDatasets')}
          </label>
        )}
        <label className="field">
          {t('export.watermark')}
          <input
            value={options.watermark}
            maxLength={200}
            placeholder={t('export.watermarkPlaceholder')}
            onChange={(e) => change({ watermark: e.target.value })}
          />
        </label>
      </section>
      <section className="panel">
        <h3>{t('export.review')}</h3>
        {!review ? (
          <p className="muted">{t('export.loadingReview')}</p>
        ) : (
          <table className="review">
            <thead>
              <tr>
                <th scope="col">{t('export.col.chart')}</th>
                <th scope="col">{t('export.col.data')}</th>
                <th scope="col" className="num">
                  {t('export.col.points')}
                </th>
                <th scope="col" className="num">
                  {t('export.col.size')}
                </th>
              </tr>
            </thead>
            <tbody>
              {review.rows.map((r) => {
                const reducible = review.has_preview.includes(r.key)
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      {reducible || options.preview_only.includes(r.key) ? (
                        <select
                          aria-label={t('export.dataFor', { name: r.name })}
                          value={r.level === 'preview' ? 'preview' : 'data'}
                          onChange={(e) => togglePreview(r.key, e.target.value === 'preview')}
                        >
                          <option value="data">{t(r.level === 'datasets' ? 'export.level.datasets' : 'export.level.data')}</option>
                          <option value="preview">{t('export.level.preview')}</option>
                        </select>
                      ) : (
                        t(`export.level.${r.level}`)
                      )}
                    </td>
                    <td className="num">{r.points.toLocaleString()}</td>
                    <td className="num">{kb(r.bytes)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {review?.total_bytes != null && <p>{t('export.total', { size: mb(review.total_bytes) })}</p>}
        {over && (
          <p className="warn">{t('export.tooLarge', { size: mb(review!.budget_bytes) })}</p>
        )}
        {review?.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {review?.error && <p className="warn">{review.error}</p>}
      </section>
      <section className="panel">
        {dirty && <p className="warn">{t('export.saveFirst')}</p>}
        <label className="check">
          <input type="checkbox" checked={confirmed} disabled={!review || !!review.error || pending} onChange={(e) => setConfirmed(e.target.checked)} />{' '}
          {t('export.confirm')}
        </label>
        <div className="row">
          <button className="primary" disabled={!confirmed || dirty || !review || !!review.error || pending} onClick={download}>
            {t('export.download')}
          </button>
          {status && <span role="status">{status}</span>}
        </div>
      </section>
    </>
  )
}
