import { useEffect, useMemo, useRef, useState } from 'react'
import { ClockCounterClockwise, Globe, MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import type { HistoryEntry, HistoryRange } from '@shared/library'

const RANGES: { id: HistoryRange; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'hour', label: 'Last hour' },
  { id: 'day', label: 'Last 24 hours' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' }
]

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yest = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function HistoryView() {
  const rows = useNexa((s) => s.historyRows)
  const loading = useNexa((s) => s.historyLoading)
  const id = useNexa((s) => s.activeProfile)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<HistoryRange>('all')
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    useNexa.getState().refreshHistory({ range })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function runQuery(nextSearch: string, nextRange: HistoryRange) {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      useNexa.getState().refreshHistory({ search: nextSearch, range: nextRange })
    }, 180)
  }

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const e of rows) {
      const key = dayLabel(e.lastVisitedAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries())
  }, [rows])

  async function del(entryId: string) {
    const res = await window.nexa.history.remove({ profileId: id, id: entryId })
    if (res?.ok) useNexa.getState().refreshHistory({ search, range })
  }
  async function clearRange() {
    const label = RANGES.find((r) => r.id === range)?.label || 'range'
    if (!window.confirm(`Clear history — ${label}?`)) return
    const res = await window.nexa.history.clear({ profileId: id, range })
    if (res?.ok) {
      useNexa.getState().refreshHistory({ search, range })
      useNexa.getState().toastMsg('History cleared')
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <ClockCounterClockwise size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>History</h1>
        <div className="row" style={{ flex: 1, maxWidth: 360, height: 34, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '0 12px', gap: 8, marginLeft: 12 }}>
          <MagnifyingGlass size={15} color="var(--text-3)" />
          <input
            aria-label="Search history"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              runQuery(e.target.value, range)
            }}
            placeholder="Search history"
            style={{ flex: 1, background: 'none', border: 'none', fontSize: 13 }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <select
          aria-label="Time range"
          className="field"
          style={{ width: 150, height: 32, padding: '0 10px' }}
          value={range}
          onChange={(e) => {
            const r = e.target.value as HistoryRange
            setRange(r)
            runQuery(search, r)
          }}
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button className="ghost" style={{ height: 32, color: 'var(--error)' }} onClick={clearRange}>
          <Trash size={15} /> Clear
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <ClockCounterClockwise size={34} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginTop: 10 }}>No browsing history</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Pages you visit will appear here. Private tabs are never recorded.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 820 }}>
            {groups.map(([label, entries]) => (
              <div key={label} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{label}</div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  {entries.map((e, i) => (
                    <div key={e.id} className="row" style={{ padding: '10px 14px', borderBottom: i === entries.length - 1 ? 'none' : '1px solid var(--border)', gap: 12 }}>
                      <Globe size={16} color="var(--text-3)" />
                      <span style={{ fontSize: 11.5, color: 'var(--text-3)', width: 58, flex: 'none' }}>
                        {new Date(e.lastVisitedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => useNexa.getState().openUrl(e.url)}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.url}</div>
                      </button>
                      {e.visitCount > 1 && <span className="pill">{e.visitCount}×</span>}
                      <button className="ghost" style={{ height: 26 }} onClick={() => useNexa.getState().openUrl(e.url, { newTab: true })}>
                        New tab
                      </button>
                      <button className="icon-btn" title="Remove" style={{ color: 'var(--error)' }} onClick={() => del(e.id)}>
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
