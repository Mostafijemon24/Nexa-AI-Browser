import { z } from 'zod'
import { defaultSession, type SessionState, type TabRecord } from './types'

export const SESSION_VERSION = 2

const CHROME_VIEWS = [
  'newtab',
  'downloads',
  'cloud',
  'settings',
  'about',
  'bookmarks',
  'history',
  'collections',
  'protection',
  'privacy',
  'drive',
  'web'
] as const

const persistedTabSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(300),
  url: z.string().max(4000),
  kind: z.enum(['chrome', 'web']),
  view: z.enum(CHROME_VIEWS),
  pinned: z.boolean().optional(),
  private: z.boolean().optional()
})

const workspaceSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  color: z.string().max(64)
})

export const persistedSessionSchema = z.object({
  version: z.literal(SESSION_VERSION),
  profileId: z.string().min(1).max(64),
  tabs: z.array(persistedTabSchema),
  activeTabId: z.string().max(64).optional(),
  workspaces: z.array(workspaceSchema).optional(),
  updatedAt: z.number()
})

export type PersistedSession = z.infer<typeof persistedSessionSchema>

/**
 * Accept unknown persisted JSON (any version, or legacy shape) and produce a
 * valid, current-version session. Invalid tab entries are discarded. Never
 * throws — on total corruption returns a clean default session.
 */
export function migrateSession(raw: unknown, profileId: string): PersistedSession {
  const now = Date.now()
  const clean = (): PersistedSession => {
    const d = defaultSession()
    return {
      version: SESSION_VERSION,
      profileId,
      tabs: d.tabs,
      activeTabId: d.activeTab,
      workspaces: d.workspaces,
      updatedAt: now
    }
  }
  if (!raw || typeof raw !== 'object') return clean()
  const obj = raw as Record<string, unknown>

  // Legacy (v1 / unversioned): { tabs, activeTab, workspaces }
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : []
  const tabs: TabRecord[] = []
  for (const t of rawTabs) {
    const parsed = persistedTabSchema.safeParse(t)
    if (parsed.success) {
      // Do not restore private tabs into a normal session.
      if (parsed.data.private) continue
      tabs.push(parsed.data as TabRecord)
    }
  }
  if (tabs.length === 0) return clean()

  const activeCandidate =
    (typeof obj.activeTabId === 'string' && obj.activeTabId) ||
    (typeof obj.activeTab === 'string' && obj.activeTab) ||
    ''
  const activeTabId = tabs.some((t) => t.id === activeCandidate) ? activeCandidate : tabs[0].id

  const rawWs = Array.isArray(obj.workspaces) ? obj.workspaces : []
  const workspaces = rawWs
    .map((w) => workspaceSchema.safeParse(w))
    .filter((r) => r.success)
    .map((r) => (r as { data: z.infer<typeof workspaceSchema> }).data)

  return {
    version: SESSION_VERSION,
    profileId,
    tabs,
    activeTabId,
    workspaces: workspaces.length ? workspaces : defaultSession().workspaces,
    updatedAt: now
  }
}

export function toSessionState(p: PersistedSession): SessionState {
  return {
    tabs: p.tabs,
    activeTab: p.activeTabId && p.tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId : p.tabs[0]?.id || 't1',
    workspaces: p.workspaces && p.workspaces.length ? p.workspaces : defaultSession().workspaces
  }
}

export function fromSessionState(state: SessionState, profileId: string): PersistedSession {
  // Drop private tabs before persisting; never write private sessions to disk.
  const tabs = (state.tabs || []).filter((t) => !t.private)
  return {
    version: SESSION_VERSION,
    profileId,
    tabs,
    activeTabId: tabs.some((t) => t.id === state.activeTab) ? state.activeTab : tabs[0]?.id,
    workspaces: state.workspaces,
    updatedAt: Date.now()
  }
}
