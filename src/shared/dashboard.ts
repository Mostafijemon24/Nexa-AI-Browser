/**
 * STEP 11 — NEXA Dashboard widget registry + layout logic.
 *
 * This module is the SINGLE source of truth for the set of Dashboard widgets,
 * their categories/sizes, the default layout, and the validation/migration of
 * persisted (untrusted) per-profile layout data.
 *
 * It is a pure UI-composition layer:
 *   - No React, no IPC, no I/O, no services, no state.
 *   - It never fabricates status — widgets read real state elsewhere.
 *   - Every function is deterministic and fully unit-testable.
 *
 * Persisted layout is treated as untrusted input (§43): unknown ids are
 * dropped, duplicates collapsed, order preserved, and there is always a safe
 * default. Legacy layouts are migrated once (§44) without destroying choices.
 */

export type DashboardWidgetCategory =
  | 'quick'
  | 'browser'
  | 'productivity'
  | 'privacy'
  | 'ai'
  | 'activity'
  | 'profile'

export type DashboardWidgetSize = 'small' | 'medium' | 'large'

export interface DashboardWidgetDef {
  id: string
  title: string
  description: string
  category: DashboardWidgetCategory
  size: DashboardWidgetSize
  /** Stable ordering used for the default layout and the customize list. */
  defaultOrder: number
  /** Whether the widget is shown in a fresh default layout. */
  defaultEnabled: boolean
}

/**
 * Layout schema version. Bumped when the widget set changes in a way that
 * requires migrating existing persisted layouts (see `migrateDashboardLayout`).
 */
export const DASHBOARD_LAYOUT_VERSION = 1

/**
 * The widget registry. Ordered by `defaultOrder`. Each id maps to exactly one
 * real NEXA capability that already exists (P0–P10). Adding a widget here does
 * NOT add a backend engine — it is a projection of existing state.
 */
export const DASHBOARD_WIDGETS: Record<string, DashboardWidgetDef> = {
  'quick-actions': {
    id: 'quick-actions',
    title: 'Quick Actions',
    description: 'Fast access to core browser actions',
    category: 'quick',
    size: 'large',
    defaultOrder: 0,
    defaultEnabled: true
  },
  downloads: {
    id: 'downloads',
    title: 'Downloads',
    description: 'Active, queued and recent files',
    category: 'browser',
    size: 'medium',
    defaultOrder: 1,
    defaultEnabled: true
  },
  protection: {
    id: 'protection',
    title: 'Protection',
    description: 'Content blocking status',
    category: 'browser',
    size: 'small',
    defaultOrder: 2,
    defaultEnabled: true
  },
  vpn: {
    id: 'vpn',
    title: 'VPN',
    description: 'Secure network status',
    category: 'browser',
    size: 'small',
    defaultOrder: 3,
    defaultEnabled: true
  },
  turbo: {
    id: 'turbo',
    title: 'Turbo',
    description: 'Navigation performance mode',
    category: 'browser',
    size: 'small',
    defaultOrder: 4,
    defaultEnabled: true
  },
  ai: {
    id: 'ai',
    title: 'AI',
    description: 'Local AI / Ollama status',
    category: 'ai',
    size: 'small',
    defaultOrder: 5,
    defaultEnabled: true
  },
  worker: {
    id: 'worker',
    title: 'Worker Assistant',
    description: 'Understand and fill the current page',
    category: 'ai',
    size: 'medium',
    defaultOrder: 6,
    defaultEnabled: true
  },
  drive: {
    id: 'drive',
    title: 'Google Drive',
    description: 'Cloud storage connection',
    category: 'productivity',
    size: 'medium',
    defaultOrder: 7,
    defaultEnabled: true
  },
  privacy: {
    id: 'privacy',
    title: 'Privacy',
    description: 'Privacy Center diagnostics',
    category: 'privacy',
    size: 'medium',
    defaultOrder: 8,
    defaultEnabled: true
  },
  profile: {
    id: 'profile',
    title: 'Active Profile',
    description: 'Current profile and region',
    category: 'profile',
    size: 'small',
    defaultOrder: 9,
    defaultEnabled: true
  },
  'recent-sites': {
    id: 'recent-sites',
    title: 'Recent Sites',
    description: 'Recently visited pages',
    category: 'activity',
    size: 'medium',
    defaultOrder: 10,
    defaultEnabled: true
  },
  bookmarks: {
    id: 'bookmarks',
    title: 'Bookmarks',
    description: 'Saved pages',
    category: 'productivity',
    size: 'medium',
    defaultOrder: 11,
    defaultEnabled: true
  },
  regional: {
    id: 'regional',
    title: 'Regional',
    description: 'Language, locale and timezone',
    category: 'profile',
    size: 'small',
    defaultOrder: 12,
    defaultEnabled: false
  },
  history: {
    id: 'history',
    title: 'History',
    description: 'Browsing history overview',
    category: 'activity',
    size: 'small',
    defaultOrder: 13,
    defaultEnabled: false
  },
  collections: {
    id: 'collections',
    title: 'Collections',
    description: 'Saved research groups',
    category: 'productivity',
    size: 'small',
    defaultOrder: 14,
    defaultEnabled: false
  },
  extensions: {
    id: 'extensions',
    title: 'Extensions',
    description: 'Enabled / disabled extensions',
    category: 'browser',
    size: 'small',
    defaultOrder: 15,
    defaultEnabled: false
  }
}

/**
 * Aliases from legacy (pre-STEP-11) widget ids to their STEP 11 equivalents.
 * Legacy ids that no longer map to a real widget (devtools, extensions, notes,
 * security, passwords, private-tab) are intentionally omitted → dropped.
 */
export const DASHBOARD_WIDGET_ALIASES: Record<string, string> = {
  'download-manager': 'downloads',
  downloads: 'downloads',
  'ask-ai': 'ai',
  research: 'ai',
  'google-drive': 'drive',
  'cloud-transfer': 'drive',
  bookmarks: 'bookmarks',
  recent: 'recent-sites',
  vpn: 'vpn',
  collections: 'collections',
  history: 'history'
}

export function isKnownDashboardWidget(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(DASHBOARD_WIDGETS, id)
}

/** All known widget ids, ordered by `defaultOrder`. */
export function dashboardWidgetIds(): string[] {
  return Object.values(DASHBOARD_WIDGETS)
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((w) => w.id)
}

/** The safe default layout: default-enabled widgets in `defaultOrder`. */
export function defaultDashboardLayout(): string[] {
  return Object.values(DASHBOARD_WIDGETS)
    .filter((w) => w.defaultEnabled)
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((w) => w.id)
}

/**
 * Validate an untrusted persisted layout into a safe ordered list of enabled
 * widget ids.
 *
 *   - Non-array input → default layout.
 *   - Each entry must be a string; legacy ids are aliased.
 *   - Unknown ids are dropped.
 *   - Duplicate ids collapse to the first occurrence (order preserved).
 *   - An empty result → default layout (never a blank dashboard).
 *
 * This does NOT add newly-introduced widgets; that only happens during an
 * explicit version migration (`migrateDashboardLayout`) so hidden widgets stay
 * hidden on normal reads.
 */
export function normalizeDashboardLayout(persisted: unknown): string[] {
  if (!Array.isArray(persisted)) return defaultDashboardLayout()
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of persisted) {
    if (typeof raw !== 'string') continue
    const id = DASHBOARD_WIDGET_ALIASES[raw] ?? raw
    if (!isKnownDashboardWidget(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.length ? out : defaultDashboardLayout()
}

/**
 * Migrate a persisted layout at a given schema version to the current version.
 * On an upgrade (or unknown/older version) we normalize the existing choices
 * and then append any default-enabled widgets that did not previously exist,
 * so new widgets appear once without discarding the user's prior selections.
 */
export function migrateDashboardLayout(persisted: unknown, fromVersion: unknown): string[] {
  const base = normalizeDashboardLayout(persisted)
  if (fromVersion === DASHBOARD_LAYOUT_VERSION) return base
  const merged = base.slice()
  for (const id of defaultDashboardLayout()) {
    if (!merged.includes(id)) merged.push(id)
  }
  return merged
}

/** Move a widget one slot up (dir < 0) or down (dir > 0). Pure. */
export function moveWidget(layout: string[], id: string, dir: -1 | 1): string[] {
  const list = normalizeDashboardLayout(layout)
  const i = list.indexOf(id)
  if (i < 0) return list
  const j = i + dir
  if (j < 0 || j >= list.length) return list
  const next = list.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Show (enable) a widget by appending it if known and not present. Pure. */
export function showWidget(layout: string[], id: string): string[] {
  const list = normalizeDashboardLayout(layout)
  if (!isKnownDashboardWidget(id) || list.includes(id)) return list
  return [...list, id]
}

/** Hide (disable) a widget. Pure. */
export function hideWidget(layout: string[], id: string): string[] {
  return normalizeDashboardLayout(layout).filter((x) => x !== id)
}

/** The set of known widgets not currently enabled, ordered by `defaultOrder`. */
export function hiddenDashboardWidgets(layout: string[]): string[] {
  const enabled = new Set(normalizeDashboardLayout(layout))
  return dashboardWidgetIds().filter((id) => !enabled.has(id))
}
