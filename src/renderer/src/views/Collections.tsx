import { useState } from 'react'
import {
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  Globe,
  PencilSimple,
  Plus,
  Stack,
  Trash
} from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import type { Collection } from '@shared/library'

export function CollectionsView() {
  const store = useNexa((s) => s.collections)
  const id = useNexa((s) => s.activeProfile)
  const collections = store?.collections || []
  const [openId, setOpenId] = useState<string | null>(collections[0]?.id ?? null)

  async function create() {
    const name = window.prompt('Collection name', 'New Collection')
    if (name === null) return
    const res = await window.nexa.collections.create({ profileId: id, name })
    if (res?.ok) {
      useNexa.setState({ collections: res.data })
      setOpenId(res.data.collections[res.data.collections.length - 1]?.id ?? null)
    }
  }
  async function rename(c: Collection) {
    const name = window.prompt('Rename collection', c.name)
    if (name === null) return
    const res = await window.nexa.collections.rename({ profileId: id, id: c.id, name })
    if (res?.ok) useNexa.setState({ collections: res.data })
  }
  async function remove(c: Collection) {
    if (!window.confirm(`Delete collection "${c.name}"?`)) return
    const res = await window.nexa.collections.remove({ profileId: id, id: c.id })
    if (res?.ok) useNexa.setState({ collections: res.data })
  }
  async function addCurrent(c: Collection) {
    const tab = useNexa.getState().session.tabs.find((t) => t.id === useNexa.getState().session.activeTab)
    if (!tab || tab.kind !== 'web' || !tab.url) {
      useNexa.getState().toastMsg('Open a web page to add it', 'warn')
      return
    }
    const res = await window.nexa.collections.addItem({ profileId: id, collectionId: c.id, title: tab.title, url: tab.url })
    if (res?.ok) {
      useNexa.setState({ collections: res.data })
      useNexa.getState().toastMsg('Added to ' + c.name)
    } else {
      useNexa.getState().toastMsg(res?.error?.message || 'Could not add', 'err')
    }
  }
  async function removeItem(c: Collection, itemId: string) {
    const res = await window.nexa.collections.removeItem({ profileId: id, collectionId: c.id, itemId })
    if (res?.ok) useNexa.setState({ collections: res.data })
  }
  async function reorder(c: Collection, itemId: string, index: number) {
    const res = await window.nexa.collections.reorderItem({ profileId: id, collectionId: c.id, itemId, index })
    if (res?.ok) useNexa.setState({ collections: res.data })
  }
  function openAll(c: Collection) {
    for (const item of c.items) useNexa.getState().openUrl(item.url, { newTab: true })
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <Stack size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Collections</h1>
        <button className="primary" style={{ height: 32 }} onClick={create}>
          <Plus size={14} /> New collection
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {collections.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <Stack size={34} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginTop: 10 }}>No collections yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Create a collection to organize related pages.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {collections.map((c) => {
              const open = openId === c.id
              return (
                <div key={c.id} className="card" style={{ overflow: 'hidden' }}>
                  <div className="row" style={{ padding: '12px 14px', gap: 10, borderBottom: open ? '1px solid var(--border)' : 'none' }}>
                    <button style={{ flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }} onClick={() => setOpenId(open ? null : c.id)}>
                      {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                      <span className="pill">{c.items.length}</span>
                    </button>
                    <button className="ghost" style={{ height: 28 }} onClick={() => addCurrent(c)}>
                      <Plus size={13} /> Add page
                    </button>
                    <button className="ghost" style={{ height: 28 }} disabled={!c.items.length} onClick={() => openAll(c)}>
                      <ArrowSquareOut size={13} /> Open all
                    </button>
                    <button className="icon-btn" title="Rename" onClick={() => rename(c)}>
                      <PencilSimple size={15} />
                    </button>
                    <button className="icon-btn" title="Delete" style={{ color: 'var(--error)' }} onClick={() => remove(c)}>
                      <Trash size={15} />
                    </button>
                  </div>
                  {open &&
                    (c.items.length === 0 ? (
                      <div style={{ padding: '18px 16px', fontSize: 13, color: 'var(--text-3)' }}>No pages yet. Open a web page and press “Add page”.</div>
                    ) : (
                      c.items
                        .slice()
                        .sort((a, b) => a.index - b.index)
                        .map((item, i, arr) => (
                          <div key={item.id} className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', gap: 10 }}>
                            <Globe size={16} color="var(--text-3)" />
                            <button style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => useNexa.getState().openUrl(item.url)}>
                              <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                              <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.url}</div>
                            </button>
                            <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => reorder(c, item.id, i - 1)}>
                              <CaretUp size={14} />
                            </button>
                            <button className="icon-btn" title="Move down" disabled={i === arr.length - 1} onClick={() => reorder(c, item.id, i + 1)}>
                              <CaretDown size={14} />
                            </button>
                            <button className="icon-btn" title="Remove" style={{ color: 'var(--error)' }} onClick={() => removeItem(c, item.id)}>
                              <Trash size={14} />
                            </button>
                          </div>
                        ))
                    ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
