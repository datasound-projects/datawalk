// Viewer parts that exist only when a DataWalk Hub serves the report.
import { useCallback, useEffect, useState } from 'react'
import { type Comment, loadComments, postComment, resolveComment } from '../app/api'
import { rich, t } from '../i18n'
import { useViewer, useViewerPick } from '../state/store'
import { startTour, stopTour } from '../tour/tour'
import { joinLive, leaveLive, setFollowing } from './live'

/** Revision, classification label, analytics notice, and live follow controls. */
export function HubBar() {
  const { hub, live, presenting } = useViewerPick('hub', 'live', 'presenting')
  if (!hub) return null
  const lead = hub.role !== 'viewer'
  return (
    <div className="hub-bar" role="region" aria-label={t('hub.label')}>
      {hub.revision !== hub.latest ? (
        <span>
          {t('hub.revision', { revision: hub.revision })} · <a href="../../">{t('hub.latest', { latest: hub.latest })}</a>
        </span>
      ) : (
        <span className="muted">{t('hub.revision', { revision: hub.revision })}</span>
      )}
      {hub.analytics && <span className="muted">{t('hub.analytics')}</span>}
      {live?.role === 'attendee' && live.presenter && (
        <span className="live">
          {live.following ? (
            <>
              {rich('hub.following', { presenter: <strong>{live.presenter}</strong> })}{' '}
              <button onClick={() => setFollowing(false)}>{t('hub.breakAway')}</button>
            </>
          ) : (
            <>
              {t('hub.exploring')} · <button onClick={() => setFollowing(true)}>{t('hub.follow', { name: live.presenter })}</button>{' '}
              <span className="muted">{rich('hub.orPress', { key: <kbd>F</kbd> })}</span>
            </>
          )}
        </span>
      )}
      {lead && live?.role !== 'presenter' && (
        <button
          onClick={() => {
            joinLive('presenter')
            if (!presenting) startTour(0)
          }}
        >
          {t('hub.presentLive')}
        </button>
      )}
      {live?.role === 'presenter' && (
        <span className="live">
          {t('hub.live', { following: live.followers.filter((f) => f.following).length, total: live.followers.length })}
          {live.followers.length > 0 && (
            <span className="muted"> ({live.followers.map((f) => (f.following ? f.name : t('hub.away', { name: f.name }))).join(', ')})</span>
          )}{' '}
          <button
            onClick={() => {
              leaveLive()
              stopTour()
              joinLive('attendee')
            }}
          >
            {t('hub.endLive')}
          </button>
        </span>
      )}
    </div>
  )
}

/** Threads pinned to a chart: comments, @mentions (e-mail), questions from meetings. */
export function Comments({ vizKey }: { vizKey: string }) {
  const user = useViewer((s) => s.hub?.user)
  const role = useViewer((s) => s.hub?.role)
  const [all, setAll] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [reply, setReply] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => loadComments().then(setAll, (e) => setError(String(e))), [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000) // questions arrive during meetings
    return () => clearInterval(t)
  }, [refresh])
  const mine = all.filter((c) => c.key === vizKey)
  const threads = mine.filter((c) => c.parent === null)
  const send = async (kind: Comment['kind']) => {
    if (!text.trim()) return
    try {
      await postComment(vizKey, text, kind, reply)
      setText('')
      setReply(null)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <section className="comments" aria-label={t('comments.label')}>
      <h3>{t('comments.title')}</h3>
      {threads.length === 0 && <p className="muted">{t('comments.none')}</p>}
      <ul>
        {threads.map((c) => (
          <li key={c.id} className={c.resolved ? 'resolved' : ''}>
            <p>
              <strong>{c.author}</strong> {c.kind === 'question' && <span className="badge">{t('comments.question')}</span>} {c.body}
            </p>
            <ul>
              {mine
                .filter((r) => r.parent === c.id)
                .map((r) => (
                  <li key={r.id}>
                    <strong>{r.author}</strong> {r.body}
                  </li>
                ))}
            </ul>
            {user && (
              <div className="row">
                <button className="link" onClick={() => setReply(c.id)}>
                  {t('comments.reply')}
                </button>
                {(role !== 'viewer' || c.author === user) && (
                  <button className="link" onClick={() => resolveComment(c.id, !c.resolved).then(refresh)}>
                    {c.resolved ? t('comments.reopen') : t('comments.resolve')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {user ? (
        <div className="comment-form">
          <label>
            {reply ? t('comments.replyLabel') : t('comments.newLabel')}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </label>
          <div className="row">
            <button onClick={() => send('comment')}>{reply ? t('comments.reply') : t('comments.comment')}</button>
            {!reply && <button onClick={() => send('question')}>{t('comments.ask')}</button>}
            {reply && <button onClick={() => setReply(null)}>{t('common.cancel')}</button>}
          </div>
        </div>
      ) : (
        <p className="muted">{t('comments.signIn')}</p>
      )}
      {error && <p className="warn">{error}</p>}
    </section>
  )
}

/** Signed out (or the frame of an embedding site has no session): sign in, in a popup when embedded. */
export function SignIn() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => e.origin === location.origin && e.data === 'datawalk-signed-in' && location.reload()
    addEventListener('message', onMessage)
    return () => removeEventListener('message', onMessage)
  }, [])
  const next = encodeURIComponent(location.pathname)
  const embedded = window.top !== window.self
  return (
    <div className="overlay lobby">
      <div className="card">
        <h1>{t('signIn.title')}</h1>
        <p>{t('signIn.text')}</p>
        {embedded ? (
          <button className="primary" onClick={() => window.open(`/login?popup=1&next=${next}`, 'datawalk-sign-in', 'popup,width=480,height=640')}>
            {t('signIn.title')}
          </button>
        ) : (
          <a href={`/login?next=${next}`}>
            <button className="primary">{t('signIn.title')}</button>
          </a>
        )}
      </div>
    </div>
  )
}
