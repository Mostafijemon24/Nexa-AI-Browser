import { useMemo, useState } from 'react'
import {
  BookmarkSimple,
  CaretRight,
  DownloadSimple,
  FolderSimple,
  FolderSimplePlus,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  Trash,
  UploadSimple,
  X
} from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { ROOT_BAR, ROOT_IDS, type BookmarkItem } from '@shared/library'

export function BookmarksView() {
  const bookmarks = useNexa((s) => s.bookmarks)
  const items = useMemo(() => bookmarks?.items || [], [bookmarks])
  const [selected, setSelected] = useState<string>(ROOT_BAR)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<BookmarkItem | null>(null)

  const folders = useMemo(() => items.filter((i) => i.type === 'folder'), [items])
  const q = search.trim().toLowerCase()

  const rows = useMemo(() => {
    if (q) {
      return items
        .filter((i) => i.type === 'bookmark' && (i.title.toLowerCase().includes(q) || (i.url || '').toLowerCase().includes(q)))
        .sort((a, b) => a.title.localeCompare(b.title))
    }
    return items.filter((i) => i.parentId === selected).sort((a, b) => a.index - b.index)
  }, [items, selected, q])

  const id = useNexa((s) => s.activeProfile)

  async function createFolder() {
    const name = window.prompt('Folder name', 'New Folder')
    if (name === null) return
    const res = await window.nexa.bookmarks.createFolder({ profileId: id, title: name, parentId: selected })
    if (res?.ok) useNexa.setState({ bookmarks: res.data })
  }
  async function remove(item: BookmarkItem) {
    if (item.type === 'folder' && !window.confirm(`Delete folder "${item.title}" and its contents?`)) return
    const res = await window.nexa.bookmarks.remove({ profileId: id, id: item.id })
    if (res?.ok) {
      useNexa.setState({ bookmarks: res.data })
      if (item.id === selected) setSelected(ROOT_BAR)
      useNexa.getState().toastMsg('Deleted')
    }
  }
  async function importFile() {
    const res = await window.nexa.bookmarks.importFile(id)
    if (res?.ok) {
      useNexa.setState({ bookmarks: res.data.store })
      useNexa.getState().toastMsg(res.data.imported ? `Imported ${res.data.imported} bookmarks` : 'Nothing imported')
    } else {
      useNexa.getState().toastMsg(res?.error?.message || 'Import failed', 'err')
    }
  }
  async function exportFile() {
    const res = await window.nexa.bookmarks.exportFile(id)
    if (res?.ok && res.data.saved) useNexa.getState().toastMsg('Bookmarks exported')
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* Folder tree */}
      <div style={{ width: 'clamp(160px, 26%, 240px)', flex: 'none', borderRight: '1px solid var(--border)', background: 'var(--chrome)', padding: 10, overflow: 'auto' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '2px 8px 8px' }}>
          Folders
        </div>
        <FolderTree items={folders} parentId={null} depth={0} selected={selected} onSelect={setSelected} />
        <button className="nav-btn" style={{ width: '100%', marginTop: 8, color: 'var(--accent-2)' }} onClick={createFolder}>
          <FolderSimplePlus size={16} />
          <span style={{ fontSize: 13 }}>New folder</span>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <BookmarkSimple size={20} color="var(--accent)" weight="fill" />
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 'none' }}>Bookmarks</h1>
          <div className="row" style={{ flex: 1, maxWidth: 360, height: 34, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '0 12px', gap: 8, marginLeft: 12 }}>
            <MagnifyingGlass size={15} color="var(--text-3)" />
            <input
              aria-label="Search bookmarks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bookmarks"
              style={{ flex: 1, background: 'none', border: 'none', fontSize: 13 }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <button className="ghost" style={{ height: 32 }} onClick={importFile} title="Import HTML bookmarks">
            <UploadSimple size={15} /> Import
          </button>
          <button className="ghost" style={{ height: 32 }} onClick={exportFile} title="Export HTML bookmarks">
            <DownloadSimple size={15} /> Export
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="card" style={{ overflow: 'hidden', maxWidth: 820 }}>
              {rows.map((item, i) => (
                <div
                  key={item.id}
                  className="row"
                  style={{ padding: '11px 14px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)', gap: 12 }}
                >
                  {item.type === 'folder' ? <FolderSimple size={17} color="var(--text-2)" /> : <Globe size={17} color="var(--text-3)" />}
                  <button
                    style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
                    onClick={() => (item.type === 'folder' ? (setSearch(''), setSelected(item.id)) : useNexa.getState().openUrl(item.url || ''))}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                    {item.url && <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.url}</div>}
                  </button>
                  {item.type === 'bookmark' && (
                    <button className="ghost" style={{ height: 28 }} onClick={() => useNexa.getState().openUrl(item.url || '', { newTab: true })}>
                      Open in new tab
                    </button>
                  )}
                  <button className="icon-btn" title="Edit" onClick={() => setEditing(item)}>
                    <PencilSimple size={15} />
                  </button>
                  {!ROOT_IDS.includes(item.id) && (
                    <button className="icon-btn" title="Delete" style={{ color: 'var(--error)' }} onClick={() => remove(item)}>
                      <Trash size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && <EditModal item={editing} folders={folders} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FolderTree({
  items,
  parentId,
  depth,
  selected,
  onSelect
}: {
  items: BookmarkItem[]
  parentId: string | null
  depth: number
  selected: string
  onSelect: (id: string) => void
}) {
  const children = items.filter((i) => i.parentId === parentId).sort((a, b) => a.index - b.index)
  return (
    <>
      {children.map((f) => {
        const hasKids = items.some((i) => i.parentId === f.id)
        const active = selected === f.id
        return (
          <div key={f.id}>
            <button
              className="nav-btn"
              style={{
                width: '100%',
                paddingLeft: 10 + depth * 14,
                color: active ? 'var(--accent-2)' : 'var(--text-2)',
                background: active ? 'var(--accent-weak)' : 'transparent',
                fontWeight: active ? 600 : 400
              }}
              onClick={() => onSelect(f.id)}
            >
              {hasKids ? <CaretRight size={12} /> : <span style={{ width: 12 }} />}
              <FolderSimple size={15} />
              <span style={{ fontSize: 13, flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</span>
            </button>
            <FolderTree items={items} parentId={f.id} depth={depth + 1} selected={selected} onSelect={onSelect} />
          </div>
        )
      })}
    </>
  )
}

function EmptyState() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
      <BookmarkSimple size={34} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginTop: 10 }}>No bookmarks yet</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>Bookmark pages to access them quickly. Press ⌘D on any page.</div>
    </div>
  )
}

function EditModal({ item, folders, onClose }: { item: BookmarkItem; folders: BookmarkItem[]; onClose: () => void }) {
  const id = useNexa((s) => s.activeProfile)
  const [title, setTitle] = useState(item.title)
  const [url, setUrl] = useState(item.url || '')
  const [parentId, setParentId] = useState(item.parentId || '')

  async function save() {
    const upd = await window.nexa.bookmarks.update({ profileId: id, title, ...(item.type === 'bookmark' ? { url } : {}), id: item.id })
    if (!upd?.ok) {
      useNexa.getState().toastMsg(upd?.error?.message || 'Could not save', 'err')
      return
    }
    let store = upd.data
    if (!ROOT_IDS.includes(item.id) && parentId && parentId !== item.parentId) {
      const mv = await window.nexa.bookmarks.move({ profileId: id, id: item.id, parentId })
      if (mv?.ok) store = mv.data
    }
    useNexa.setState({ bookmarks: store })
    useNexa.getState().toastMsg('Saved')
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <PencilSimple size={17} color="var(--accent)" />
          <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>Edit {item.type}</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 18 }}>
          <label style={labelCss}>Title</label>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
          {item.type === 'bookmark' && (
            <>
              <div style={{ height: 12 }} />
              <label style={labelCss}>URL</label>
              <input className="field mono" value={url} onChange={(e) => setUrl(e.target.value)} />
            </>
          )}
          {!ROOT_IDS.includes(item.id) && (
            <>
              <div style={{ height: 12 }} />
              <label style={labelCss}>Folder</label>
              <select
                className="field"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                style={{ padding: '0 10px' }}
              >
                {folders
                  .filter((f) => f.id !== item.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
              </select>
            </>
          )}
        </div>
        <div className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', justifyContent: 'flex-end', gap: 10 }}>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const labelCss = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: 8 } as const
