import { useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  DotsThreeVertical,
  DownloadSimple,
  FolderOpen,
  Info,
  LinkSimple,
  Pause,
  Play,
  Trash,
  Warning,
  X,
  XCircle
} from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { isActive, type DownloadItem, type DownloadStatus } from '@shared/downloads'

/* ----------------------------- formatting ----------------------------- */

function formatBytes(n?: number): string {
  if (n === undefined || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return ''
  return `${formatBytes(bps)}/s`
}

function formatEta(sec?: number): string {
  if (sec === undefined || sec < 0) return ''
  if (sec < 1) return '0s'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

function statusColor(s: DownloadStatus): string {
  if (s === 'downloading') return 'var(--accent)'
  if (s === 'completed') return 'var(--success)'
  if (s === 'failed') return 'var(--error)'
  if (s === 'paused' || s === 'queued') return 'var(--warning)'
  return 'var(--text-3)'
}

/* ------------------------------- view ------------------------------- */

export function DownloadsView() {
  const downloads = useNexa((s) => s.downloads)
  const id = useNexa((s) => s.activeProfile)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    useNexa.getState().loadDownloads()
     
  }, [id])

  const active = downloads.filter((d) => isActive(d.status))
  const completed = downloads.filter((d) => d.status === 'completed')
  const failed = downloads.filter((d) => d.status === 'failed' || d.status === 'cancelled')
  const detailItem = detailsId ? downloads.find((d) => d.id === detailsId) || null : null

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <DownloadSimple size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Downloads</h1>
        {active.length > 0 && (
          <span className="pill" style={{ background: 'var(--accent-weak)', color: 'var(--accent-2)' }}>
            {active.length} active
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="ghost" style={{ height: 32 }} onClick={() => window.nexa.downloads.openFolder(id)}>
          <FolderOpen size={15} /> Open folder
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className="icon-btn"
            aria-label="Download menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <DotsThreeVertical size={18} weight="bold" />
          </button>
          {menuOpen && (
            <DownloadMenu
              profileId={id}
              onClose={() => setMenuOpen(false)}
              hasActive={active.some((d) => d.status === 'downloading')}
              hasPaused={active.some((d) => d.status === 'paused')}
              hasCompleted={completed.length > 0}
              hasFailed={failed.length > 0}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {downloads.length === 0 ? (
          <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <DownloadSimple size={36} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginTop: 10 }}>No downloads yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Files you download will appear here. Choose your destination and duplicate behavior in Settings → Downloads.
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <Section title="Active" count={active.length} items={active} onDetails={setDetailsId} />
            <Section title="Completed" count={completed.length} items={completed} onDetails={setDetailsId} />
            <Section title="Failed & Cancelled" count={failed.length} items={failed} onDetails={setDetailsId} />
          </div>
        )}
      </div>

      {detailItem && <DetailsModal item={detailItem} onClose={() => setDetailsId(null)} />}
    </div>
  )
}

function Section({
  title,
  count,
  items,
  onDetails
}: {
  title: string
  count: number
  items: DownloadItem[]
  onDetails: (id: string) => void
}) {
  if (count === 0) return null
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginBottom: 8
        }}
      >
        {title} · {count}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {items.map((d, i) => (
          <Row key={d.id} item={d} last={i === items.length - 1} onDetails={onDetails} />
        ))}
      </div>
    </div>
  )
}

function Row({ item, last, onDetails }: { item: DownloadItem; last: boolean; onDetails: (id: string) => void }) {
  const id = useNexa((s) => s.activeProfile)
  const pct =
    item.totalBytes && item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : null

  async function act(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    const res = await fn()
    if (!res?.ok) useNexa.getState().toastMsg(res?.error?.message || 'Action failed', 'err')
  }

  const sizeLine =
    item.totalBytes && item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
      : item.status === 'completed'
        ? formatBytes(item.receivedBytes || item.totalBytes)
        : `${formatBytes(item.receivedBytes)} downloaded`

  return (
    <div
      className="row"
      style={{ padding: '11px 14px', borderBottom: last ? 'none' : '1px solid var(--border)', gap: 12, alignItems: 'flex-start' }}
    >
      <div style={{ marginTop: 2 }}>
        {item.status === 'completed' ? (
          <CheckCircle size={18} color="var(--success)" weight="fill" />
        ) : item.status === 'failed' ? (
          <Warning size={18} color="var(--error)" weight="fill" />
        ) : item.status === 'cancelled' ? (
          <XCircle size={18} color="var(--text-3)" />
        ) : (
          <DownloadSimple size={18} color={statusColor(item.status)} weight={item.status === 'downloading' ? 'fill' : 'regular'} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={item.filename}
        >
          {item.filename}
          {item.private && (
            <span className="pill" style={{ marginLeft: 8 }}>
              Private
            </span>
          )}
        </div>
        {pct !== null && item.status !== 'completed' && item.status !== 'cancelled' && (
          <div style={{ height: 4, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', margin: '6px 0' }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: statusColor(item.status),
                transition: 'width 0.2s ease'
              }}
            />
          </div>
        )}
        <div className="row" style={{ gap: 10, fontSize: 11.5, color: 'var(--text-3)', flexWrap: 'wrap' }}>
          <span style={{ color: statusColor(item.status), fontWeight: 600 }}>{STATUS_LABEL[item.status]}</span>
          <span>{sizeLine}</span>
          {pct !== null && item.status === 'downloading' && <span>{pct}%</span>}
          {item.status === 'downloading' && formatSpeed(item.speedBytesPerSecond) && (
            <span>{formatSpeed(item.speedBytesPerSecond)}</span>
          )}
          {item.status === 'downloading' &&
            (item.etaSeconds !== undefined ? (
              <span>{formatEta(item.etaSeconds)} left</span>
            ) : item.totalBytes ? (
              <span>Calculating…</span>
            ) : null)}
          {item.status === 'failed' && item.errorMessage && (
            <span style={{ color: 'var(--error)' }}>{item.errorMessage}</span>
          )}
          {item.retryCount > 0 && <span>· retry {item.retryCount}</span>}
        </div>
      </div>
      <div className="row" style={{ gap: 3, flex: 'none' }}>
        {item.status === 'downloading' && (
          <IconAct label="Pause" onClick={() => act(() => window.nexa.downloads.pause({ profileId: id, id: item.id }))}>
            <Pause size={15} />
          </IconAct>
        )}
        {(item.status === 'paused' || item.status === 'queued') && (
          <IconAct label="Resume" onClick={() => act(() => window.nexa.downloads.resume({ profileId: id, id: item.id }))}>
            <Play size={15} />
          </IconAct>
        )}
        {isActive(item.status) && (
          <IconAct label="Cancel" onClick={() => act(() => window.nexa.downloads.cancel({ profileId: id, id: item.id }))}>
            <X size={15} />
          </IconAct>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && (
          <IconAct label="Retry" onClick={() => act(() => window.nexa.downloads.retry({ profileId: id, id: item.id }))}>
            <ArrowClockwise size={15} />
          </IconAct>
        )}
        {item.status === 'completed' && (
          <>
            <IconAct label="Open file" onClick={() => act(() => window.nexa.downloads.open({ profileId: id, id: item.id }))}>
              <Play size={15} />
            </IconAct>
            <IconAct label="Show in folder" onClick={() => act(() => window.nexa.downloads.showInFolder({ profileId: id, id: item.id }))}>
              <FolderOpen size={15} />
            </IconAct>
          </>
        )}
        <IconAct
          label="Copy URL"
          onClick={async () => {
            const res = await window.nexa.downloads.copyUrl({ profileId: id, id: item.id })
            if (res?.ok) {
              try {
                await navigator.clipboard.writeText(res.data.url)
                useNexa.getState().toastMsg('Download URL copied')
              } catch {
                useNexa.getState().toastMsg('Could not copy URL', 'err')
              }
            }
          }}
        >
          <LinkSimple size={15} />
        </IconAct>
        <IconAct label="Details" onClick={() => onDetails(item.id)}>
          <Info size={15} />
        </IconAct>
        <IconAct
          label="Remove from list"
          onClick={() => act(() => window.nexa.downloads.remove({ profileId: id, id: item.id }))}
        >
          <Trash size={15} />
        </IconAct>
      </div>
    </div>
  )
}

function IconAct({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" title={label} aria-label={label} onClick={onClick} style={{ width: 28, height: 28 }}>
      {children}
    </button>
  )
}

function DownloadMenu({
  profileId,
  onClose,
  hasActive,
  hasPaused,
  hasCompleted,
  hasFailed
}: {
  profileId: string
  onClose: () => void
  hasActive: boolean
  hasPaused: boolean
  hasCompleted: boolean
  hasFailed: boolean
}) {
  const items: { label: string; disabled?: boolean; act: () => void }[] = [
    { label: 'Pause all', disabled: !hasActive, act: () => window.nexa.downloads.pauseAll(profileId) },
    { label: 'Resume all', disabled: !hasPaused, act: () => window.nexa.downloads.resumeAll(profileId) },
    {
      label: 'Clear completed',
      disabled: !hasCompleted,
      act: async () => {
        const r = await window.nexa.downloads.clearCompleted(profileId)
        if (r?.ok) useNexa.setState({ downloads: r.data })
      }
    },
    {
      label: 'Clear failed & cancelled',
      disabled: !hasFailed,
      act: async () => {
        const r = await window.nexa.downloads.clearFailed(profileId)
        if (r?.ok) useNexa.setState({ downloads: r.data })
      }
    },
    { label: 'Open downloads folder', act: () => window.nexa.downloads.openFolder(profileId) },
    { label: 'Download settings', act: () => useNexa.getState().setView('settings', 'downloads') }
  ]
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        role="menu"
        className="popover"
        style={{ position: 'absolute', top: 34, right: 0, width: 220, zIndex: 41, padding: 6 }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            disabled={it.disabled}
            className="row"
            style={{
              width: '100%',
              padding: '9px 11px',
              borderRadius: 8,
              textAlign: 'left',
              fontSize: 13,
              opacity: it.disabled ? 0.4 : 1
            }}
            onClick={() => {
              if (it.disabled) return
              it.act()
              onClose()
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

function DetailsModal({ item, onClose }: { item: DownloadItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  const rows: [string, string][] = [
    ['Status', STATUS_LABEL[item.status]],
    ['Filename', item.filename],
    ['Destination', item.destinationDir || '—'],
    ['Saved to', item.savePath || '—'],
    ['Size', item.totalBytes ? formatBytes(item.totalBytes) : 'Unknown'],
    ['Received', formatBytes(item.receivedBytes)],
    ['MIME type', item.mimeType || '—'],
    ['Retry count', String(item.retryCount)],
    ['Started', item.startedAt ? new Date(item.startedAt).toLocaleString() : '—'],
    ['Completed', item.completedAt ? new Date(item.completedAt).toLocaleString() : '—']
  ]
  if (item.errorMessage) rows.push(['Error', `${item.errorCode || 'error'} — ${item.errorMessage}`])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 540, maxHeight: 640, overflow: 'auto' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Download details">
        <div className="row" style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <Info size={18} color="var(--accent)" />
          <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>Download details</span>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              URL
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)', wordBreak: 'break-all' }}>
              {item.url}
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {rows.map(([k, v], i) => (
              <div
                key={k}
                className="row"
                style={{ padding: '9px 13px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)', gap: 12, alignItems: 'flex-start' }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-3)', width: 120, flex: 'none' }}>{k}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)', flex: 1, wordBreak: 'break-all' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
