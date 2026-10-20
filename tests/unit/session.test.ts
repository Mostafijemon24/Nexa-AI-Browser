import { describe, expect, it } from 'vitest'
import { SESSION_VERSION, fromSessionState, migrateSession, toSessionState } from '../../src/shared/session'
import type { SessionState } from '../../src/shared/types'

describe('session versioning', () => {
  it('migrates legacy unversioned session to current version', () => {
    const legacy = {
      tabs: [
        { id: 't1', title: 'A', url: 'https://a.com', kind: 'web', view: 'web' },
        { id: 't2', title: 'New Tab', url: '', kind: 'chrome', view: 'newtab' }
      ],
      activeTab: 't2',
      workspaces: [{ id: 'r', label: 'Research', color: '#000' }]
    }
    const s = migrateSession(legacy, 'research')
    expect(s.version).toBe(SESSION_VERSION)
    expect(s.profileId).toBe('research')
    expect(s.tabs).toHaveLength(2)
    expect(s.activeTabId).toBe('t2')
  })

  it('discards invalid tab entries but keeps valid ones', () => {
    const s = migrateSession(
      { tabs: [{ id: 't1', title: 'A', url: 'https://a.com', kind: 'web', view: 'web' }, { garbage: true }, 42], activeTab: 't1' },
      'p1'
    )
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].id).toBe('t1')
  })

  it('never restores private tabs into a normal session', () => {
    const s = migrateSession(
      {
        tabs: [
          { id: 't1', title: 'A', url: 'https://a.com', kind: 'web', view: 'web' },
          { id: 't2', title: 'secret', url: 'https://x.com', kind: 'web', view: 'web', private: true }
        ],
        activeTab: 't2'
      },
      'p1'
    )
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs.find((t) => t.id === 't2')).toBeUndefined()
    // active falls back to a surviving tab
    expect(s.activeTabId).toBe('t1')
  })

  it('returns a clean session on total corruption without throwing', () => {
    expect(migrateSession(null, 'p1').tabs.length).toBeGreaterThan(0)
    expect(migrateSession('nonsense', 'p1').tabs.length).toBeGreaterThan(0)
    expect(migrateSession({ tabs: [] }, 'p1').tabs.length).toBeGreaterThan(0)
  })

  it('falls back active tab when activeTab id is missing', () => {
    const s = migrateSession({ tabs: [{ id: 't5', title: 'A', url: 'https://a.com', kind: 'web', view: 'web' }], activeTab: 'gone' }, 'p1')
    expect(s.activeTabId).toBe('t5')
  })

  it('round-trips through SessionState and drops private on persist', () => {
    const state: SessionState = {
      tabs: [
        { id: 't1', title: 'A', url: 'https://a.com', kind: 'web', view: 'web' },
        { id: 't2', title: 'priv', url: 'https://b.com', kind: 'web', view: 'web', private: true }
      ],
      activeTab: 't1',
      workspaces: []
    }
    const persisted = fromSessionState(state, 'p1')
    expect(persisted.tabs).toHaveLength(1)
    const back = toSessionState(persisted)
    expect(back.activeTab).toBe('t1')
  })
})
