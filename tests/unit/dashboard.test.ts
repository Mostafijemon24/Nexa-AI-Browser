import { describe, it, expect } from 'vitest'
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_LAYOUT_VERSION,
  defaultDashboardLayout,
  dashboardWidgetIds,
  isKnownDashboardWidget,
  normalizeDashboardLayout,
  migrateDashboardLayout,
  moveWidget,
  showWidget,
  hideWidget,
  hiddenDashboardWidgets
} from '../../src/shared/dashboard'

describe('dashboard widget registry', () => {
  it('exposes known widget ids and rejects unknown ones', () => {
    expect(isKnownDashboardWidget('downloads')).toBe(true)
    expect(isKnownDashboardWidget('vpn')).toBe(true)
    expect(isKnownDashboardWidget('does-not-exist')).toBe(false)
    expect(isKnownDashboardWidget(42)).toBe(false)
    expect(isKnownDashboardWidget(null)).toBe(false)
    expect(isKnownDashboardWidget(undefined)).toBe(false)
  })

  it('every registry id is self-consistent and has a valid category/size', () => {
    const cats = new Set(['quick', 'browser', 'productivity', 'privacy', 'ai', 'activity', 'profile'])
    const sizes = new Set(['small', 'medium', 'large'])
    for (const [key, def] of Object.entries(DASHBOARD_WIDGETS)) {
      expect(def.id).toBe(key)
      expect(def.title.length).toBeGreaterThan(0)
      expect(cats.has(def.category)).toBe(true)
      expect(sizes.has(def.size)).toBe(true)
    }
  })

  it('defaultOrder values are unique', () => {
    const orders = Object.values(DASHBOARD_WIDGETS).map((w) => w.defaultOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('dashboardWidgetIds is ordered by defaultOrder and covers all', () => {
    const ids = dashboardWidgetIds()
    expect(ids.length).toBe(Object.keys(DASHBOARD_WIDGETS).length)
    const orders = ids.map((id) => DASHBOARD_WIDGETS[id].defaultOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })
})

describe('default layout', () => {
  it('contains only default-enabled widgets, ordered', () => {
    const layout = defaultDashboardLayout()
    expect(layout).toContain('quick-actions')
    expect(layout).toContain('downloads')
    // collections/history/regional are default-off
    expect(layout).not.toContain('collections')
    expect(layout).not.toContain('history')
    expect(layout).not.toContain('regional')
    for (const id of layout) expect(DASHBOARD_WIDGETS[id].defaultEnabled).toBe(true)
  })

  it('is deterministic (does not share mutable state)', () => {
    const a = defaultDashboardLayout()
    a.push('mutated')
    expect(defaultDashboardLayout()).not.toContain('mutated')
  })
})

describe('normalizeDashboardLayout (untrusted input)', () => {
  it('returns default for non-array input', () => {
    expect(normalizeDashboardLayout(null)).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout(undefined)).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout('downloads')).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout({ 0: 'downloads' })).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout(123)).toEqual(defaultDashboardLayout())
  })

  it('drops unknown ids and non-string entries, preserving order', () => {
    const out = normalizeDashboardLayout(['vpn', 'nope', 42, null, 'ai', {}])
    expect(out).toEqual(['vpn', 'ai'])
  })

  it('collapses duplicate ids to first occurrence', () => {
    const out = normalizeDashboardLayout(['ai', 'vpn', 'ai', 'vpn'])
    expect(out).toEqual(['ai', 'vpn'])
  })

  it('applies legacy aliases and dedupes across aliases', () => {
    const out = normalizeDashboardLayout(['download-manager', 'downloads', 'ask-ai', 'google-drive', 'recent'])
    expect(out).toEqual(['downloads', 'ai', 'drive', 'recent-sites'])
  })

  it('drops legacy ids without a modern equivalent', () => {
    const out = normalizeDashboardLayout(['devtools', 'notes', 'passwords', 'private-tab', 'bookmarks'])
    expect(out).toEqual(['bookmarks'])
  })

  it('returns default when nothing valid remains', () => {
    expect(normalizeDashboardLayout(['devtools', 'notes', 999])).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout([])).toEqual(defaultDashboardLayout())
  })

  it('preserves a valid custom subset without injecting defaults', () => {
    const out = normalizeDashboardLayout(['vpn', 'ai'])
    expect(out).toEqual(['vpn', 'ai'])
  })
})

describe('migrateDashboardLayout', () => {
  it('is a no-op (only validates) when already at current version', () => {
    const out = migrateDashboardLayout(['vpn', 'ai'], DASHBOARD_LAYOUT_VERSION)
    expect(out).toEqual(['vpn', 'ai'])
  })

  it('appends new default widgets once when upgrading from an older/unknown version', () => {
    const out = migrateDashboardLayout(['bookmarks', 'recent'], undefined)
    // legacy ids kept (aliased) and default widgets appended after them
    expect(out[0]).toBe('bookmarks')
    expect(out[1]).toBe('recent-sites')
    expect(out).toContain('downloads')
    expect(out).toContain('quick-actions')
    // default-off widgets are not force-added
    expect(out).not.toContain('collections')
  })

  it('does not resurrect a hidden default widget when at current version', () => {
    // user hid quick-actions at current version → stays hidden
    const noQuick = defaultDashboardLayout().filter((id) => id !== 'quick-actions')
    const out = migrateDashboardLayout(noQuick, DASHBOARD_LAYOUT_VERSION)
    expect(out).not.toContain('quick-actions')
  })
})

describe('reorder / hide / show', () => {
  it('moveWidget moves up and down within bounds', () => {
    const layout = ['quick-actions', 'downloads', 'vpn']
    expect(moveWidget(layout, 'downloads', -1)).toEqual(['downloads', 'quick-actions', 'vpn'])
    expect(moveWidget(layout, 'downloads', 1)).toEqual(['quick-actions', 'vpn', 'downloads'])
  })

  it('moveWidget is a no-op at edges or for unknown id', () => {
    const layout = ['quick-actions', 'downloads']
    expect(moveWidget(layout, 'quick-actions', -1)).toEqual(layout)
    expect(moveWidget(layout, 'downloads', 1)).toEqual(layout)
    expect(moveWidget(layout, 'nope', 1)).toEqual(layout)
  })

  it('hideWidget removes a widget; showWidget appends a known hidden widget', () => {
    const hidden = hideWidget(['quick-actions', 'vpn'], 'vpn')
    expect(hidden).toEqual(['quick-actions'])
    const shown = showWidget(hidden, 'collections')
    expect(shown).toEqual(['quick-actions', 'collections'])
  })

  it('showWidget ignores unknown ids and no-ops for already-visible', () => {
    expect(showWidget(['vpn'], 'nope')).toEqual(['vpn'])
    expect(showWidget(['vpn'], 'vpn')).toEqual(['vpn'])
  })

  it('hiddenDashboardWidgets returns the complement, ordered', () => {
    const enabled = ['quick-actions', 'downloads']
    const hidden = hiddenDashboardWidgets(enabled)
    expect(hidden).not.toContain('quick-actions')
    expect(hidden).not.toContain('downloads')
    expect(hidden).toContain('collections')
    // ordered by defaultOrder
    const orders = hidden.map((id) => DASHBOARD_WIDGETS[id].defaultOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })
})

describe('profile isolation (pure determinism)', () => {
  it('same input always yields same output regardless of call order', () => {
    const a = normalizeDashboardLayout(['vpn', 'ai', 'downloads'])
    const b = normalizeDashboardLayout(['vpn', 'ai', 'downloads'])
    expect(a).toEqual(b)
    // mutating one profile's result must not affect another
    a.push('collections')
    expect(normalizeDashboardLayout(['vpn', 'ai', 'downloads'])).toEqual(b)
  })
})
