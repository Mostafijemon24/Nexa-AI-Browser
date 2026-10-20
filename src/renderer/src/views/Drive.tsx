import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CloudArrowDown,
  FileArrowDown,
  Folder,
  GoogleLogo,
  MagnifyingGlass,
  Plug,
  SpinnerGap
} from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { mimeToKind, type DriveFileMetadata } from '@shared/drive'

function bytes(n?: number): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${u[i]}`
}

function when(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

function StateDot({ connected }: { connected: boolean }) {
  return (
    <span
      aria-hidden
      style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? 'var(--success)' : 'var(--text-3)' }}
    />
  )
}

/** Disconnected / not-configured panel. */
function Disconnected() {
  const meta = useNexa((s) => s.driveMeta)
  const busy = useNexa((s) => s.driveBusy)
  const notConfigured = meta?.state === 'NOT_CONFIGURED'
  return (
    <div style={{ maxWidth: 460, margin: '48px auto 0', textAlign: 'center' }}>
      <GoogleLogo size={40} color="var(--text-3)" />
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '14px 0 6px' }}>Google Drive</h2>
      <div aria-live="polite" style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.5 }}>
        {notConfigured ? (
          <>
            Not configured. Google Drive requires OAuth credentials
            (<span className="mono">NEXA_GOOGLE_CLIENT_ID</span>) to be provided in this build.
          </>
        ) : (
          'Not connected. Connect your Google account to browse and download your Drive files.'
        )}
      </div>
      <button
        className="primary"
        style={{ height: 38, padding: '0 18px' }}
        disabled={busy === 'connecting' || notConfigured}
        onClick={() => void useNexa.getState().driveConnect()}
      >
        {busy === 'connecting' ? (
          <>
            <SpinnerGap size={15} className="spin" /> Connecting…
          </>
        ) : (
          <>
            <Plug size={15} /> Connect Google Drive
          </>
        )}
      </button>
      {notConfigured && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14 }}>
          NOT_CONFIGURED — REQUIRES GOOGLE CLOUD OAUTH CREDENTIALS
        </div>
      )}
    </div>
  )
}

function FileRow({ file }: { file: DriveFileMetadata }) {
  const busy = useNexa((s) => s.driveBusy)
  const kind = useMemo(() => mimeToKind(file.mimeType), [file.mimeType])
  const action = file.isFolder ? 'Open' : file.isWorkspace ? 'Export' : 'Download'
  return (
    <div
      className="row"
      style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', gap: 12 }}
      role="row"
    >
      <span aria-hidden style={{ flex: 'none', color: 'var(--text-3)' }}>
        {file.isFolder ? <Folder size={17} weight="fill" /> : <FileArrowDown size={17} />}
      </span>
      <span
        style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={file.name}
      >
        {file.name}
      </span>
      <span className="mono" style={{ flex: 'none', width: 64, fontSize: 11, color: 'var(--text-3)' }}>{kind}</span>
      <span className="mono" style={{ flex: 'none', width: 70, fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
        {file.isFolder ? '' : bytes(file.size)}
      </span>
      <span className="mono" style={{ flex: 'none', width: 84, fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
        {when(file.modifiedTime)}
      </span>
      <span className="row" style={{ flex: 'none', gap: 6 }}>
        {file.webViewLink && (
          <button
            className="ghost"
            style={{ height: 28 }}
            onClick={() => window.nexa.shell.openExternal(file.webViewLink!)}
            aria-label={`Open ${file.name} in Google Drive`}
          >
            Open
          </button>
        )}
        <button
          className="ghost"
          style={{ height: 28 }}
          disabled={busy === 'downloading'}
          onClick={() => void useNexa.getState().driveDownload(file)}
          aria-label={`${action} ${file.name}`}
        >
          {file.isFolder ? 'Open' : action === 'Export' ? 'Export' : 'Download'}
        </button>
      </span>
    </div>
  )
}

function Connected() {
  const meta = useNexa((s) => s.driveMeta)!
  const files = useNexa((s) => s.driveFiles)
  const busy = useNexa((s) => s.driveBusy)
  const category = useNexa((s) => s.driveCategory)
  const folder = useNexa((s) => s.driveFolder)
  const query = useNexa((s) => s.driveQuery)
  const error = useNexa((s) => s.driveError)
  const [q, setQ] = useState('')

  // Debounced explicit search (no crawling; one bounded request when the user pauses).
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== query) void useNexa.getState().driveSearch(q)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const tabs: { id: 'my-drive' | 'shared' | 'recent'; label: string }[] = [
    { id: 'my-drive', label: 'My Drive' },
    { id: 'shared', label: 'Shared with me' },
    { id: 'recent', label: 'Recent' }
  ]

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <StateDot connected />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Connected</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{meta.email || 'Google account'}</div>
        </div>
        <button className="ghost" style={{ height: 30 }} onClick={() => void useNexa.getState().driveDisconnect()}>
          Disconnect
        </button>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <div className="row" style={{ flex: 1, gap: 8, background: 'var(--surface-2)', borderRadius: 8, padding: '0 10px', height: 34 }}>
          <MagnifyingGlass size={15} color="var(--text-3)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Drive…"
            aria-label="Search Google Drive"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 13 }}
          />
        </div>
      </div>

      {!query && (
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          {folder && (
            <button className="ghost" style={{ height: 28 }} onClick={() => void useNexa.getState().driveList({ category })} aria-label="Back to Drive">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          {!folder &&
            tabs.map((t) => (
              <button
                key={t.id}
                className="ghost"
                style={{ height: 28, color: category === t.id ? 'var(--accent-2)' : 'var(--text-2)', background: category === t.id ? 'var(--accent-weak)' : 'transparent' }}
                onClick={() => void useNexa.getState().driveList({ category: t.id })}
              >
                {t.label}
              </button>
            ))}
          {folder && <span style={{ fontSize: 12.5, fontWeight: 600, alignSelf: 'center' }}>{folder.name}</span>}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }} role="table" aria-label="Drive files">
        <div className="row" style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', gap: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          <span style={{ width: 17 }} aria-hidden />
          <span style={{ flex: 1 }}>Name</span>
          <span style={{ width: 64 }}>Type</span>
          <span style={{ width: 70, textAlign: 'right' }}>Size</span>
          <span style={{ width: 84, textAlign: 'right' }}>Modified</span>
          <span style={{ width: 120 }} aria-hidden />
        </div>

        <div aria-live="polite">
          {busy === 'listing' || busy === 'searching' ? (
            <div className="row" style={{ padding: 24, justifyContent: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13 }}>
              <SpinnerGap size={16} className="spin" /> {busy === 'searching' ? 'Searching…' : 'Loading files…'}
            </div>
          ) : error ? (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-2)' }}>{error}</div>
          ) : files.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-3)' }}>{query ? 'No files match your search.' : 'No files here.'}</div>
          ) : (
            files.map((f) => <FileRow key={f.id} file={f} />)
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        Downloads run through NEXA's normal download manager. Disconnecting only removes NEXA's
        access — it never deletes files from Google Drive.
      </div>
    </div>
  )
}

export function DriveView() {
  const meta = useNexa((s) => s.driveMeta)
  const id = useNexa((s) => s.activeProfile)

  useEffect(() => {
    void useNexa
      .getState()
      .driveRefreshStatus()
      .then(() => {
        const s = useNexa.getState()
        if (s.driveMeta?.connected && s.driveFiles.length === 0 && s.driveBusy === '') void s.driveList()
      })
     
  }, [id])

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <CloudArrowDown size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Google Drive</h1>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {meta?.connected ? <Connected /> : <Disconnected />}
      </div>
    </div>
  )
}
