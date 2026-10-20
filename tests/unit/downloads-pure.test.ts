import { describe, expect, it } from 'vitest'
import {
  canRetry,
  computeEta,
  computeSpeed,
  hasTraversal,
  normalizeDownloads,
  recoverStore,
  sanitizeFilename,
  scheduleQueue,
  summarize,
  uniqueFilename,
  redactUrl,
  type DownloadItem
} from '../../src/shared/downloads'

function item(partial: Partial<DownloadItem>): DownloadItem {
  return {
    id: partial.id || 'd1',
    profileId: 'alpha',
    url: 'https://example.com/f.zip',
    filename: 'f.zip',
    receivedBytes: 0,
    status: 'queued',
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial
  }
}

describe('sanitizeFilename', () => {
  it('strips path separators and traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('a/b/c.txt')).toBe('c.txt')
    expect(sanitizeFilename('..\\..\\secret.txt')).toBe('secret.txt')
  })
  it('removes invalid filesystem characters', () => {
    expect(sanitizeFilename('in<va>l:i"d|?*.txt')).toBe('invalid.txt')
  })
  it('handles empty / dot-only names', () => {
    expect(sanitizeFilename('')).toBe('download')
    expect(sanitizeFilename('   ')).toBe('download')
    expect(sanitizeFilename('...')).toBe('download')
  })
  it('guards reserved Windows names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('nul.txt')).toBe('_nul.txt')
    expect(sanitizeFilename('COM1.dat')).toBe('_COM1.dat')
  })
  it('caps extremely long names but keeps the extension', () => {
    const out = sanitizeFilename('a'.repeat(400) + '.pdf')
    expect(out.length).toBeLessThanOrEqual(255)
    expect(out.endsWith('.pdf')).toBe(true)
  })
  it('preserves unicode', () => {
    expect(sanitizeFilename('résumé café.pdf')).toBe('résumé café.pdf')
  })
})

describe('hasTraversal', () => {
  it('detects separators and dot segments', () => {
    expect(hasTraversal('..')).toBe(true)
    expect(hasTraversal('a/b')).toBe(true)
    expect(hasTraversal('a\\b')).toBe(true)
    expect(hasTraversal('file.txt')).toBe(false)
  })
})

describe('uniqueFilename', () => {
  it('keeps name when no collision', () => {
    expect(uniqueFilename([], 'file.pdf', 'rename')).toBe('file.pdf')
  })
  it('appends increasing suffixes on collision (rename)', () => {
    expect(uniqueFilename(['file.pdf'], 'file.pdf', 'rename')).toBe('file (1).pdf')
    expect(uniqueFilename(['file.pdf', 'file (1).pdf'], 'file.pdf', 'rename')).toBe('file (2).pdf')
  })
  it('handles names without extension', () => {
    expect(uniqueFilename(['README'], 'README', 'rename')).toBe('README (1)')
  })
  it('replace policy keeps the name', () => {
    expect(uniqueFilename(['file.pdf'], 'file.pdf', 'replace')).toBe('file.pdf')
  })
})

describe('computeSpeed / computeEta', () => {
  it('averages over the rolling window', () => {
    const s = computeSpeed([
      { t: 0, bytes: 0 },
      { t: 1000, bytes: 1_000_000 },
      { t: 2000, bytes: 2_000_000 }
    ])
    expect(s).toBeGreaterThan(900_000)
    expect(s).toBeLessThan(1_100_000)
  })
  it('returns 0 with insufficient samples', () => {
    expect(computeSpeed([{ t: 0, bytes: 0 }])).toBe(0)
  })
  it('eta only when total known and speed positive', () => {
    expect(computeEta(undefined, 100, 50)).toBeUndefined()
    expect(computeEta(1000, 100, 0)).toBeUndefined()
    expect(computeEta(1000, 200, 100)).toBe(8)
    expect(computeEta(1000, 1000, 100)).toBe(0)
  })
})

describe('scheduleQueue / concurrency', () => {
  it('promotes only up to free slots, oldest first', () => {
    const items = [
      item({ id: 'a', status: 'downloading', createdAt: 1 }),
      item({ id: 'b', status: 'queued', createdAt: 2 }),
      item({ id: 'c', status: 'queued', createdAt: 3 })
    ]
    expect(scheduleQueue(items, 2)).toEqual(['b'])
    expect(scheduleQueue(items, 3)).toEqual(['b', 'c'])
    expect(scheduleQueue(items, 1)).toEqual([])
  })
})

describe('canRetry', () => {
  it('respects the retry limit and only failed/cancelled', () => {
    expect(canRetry(item({ status: 'failed', retryCount: 0 }), 3)).toBe(true)
    expect(canRetry(item({ status: 'failed', retryCount: 3 }), 3)).toBe(false)
    expect(canRetry(item({ status: 'cancelled', retryCount: 1 }), 3)).toBe(true)
    expect(canRetry(item({ status: 'downloading', retryCount: 0 }), 3)).toBe(false)
  })
})

describe('recoverStore (restart recovery)', () => {
  it('marks non-terminal downloads as retryable failed, preserves terminal ones', () => {
    const store = {
      version: 1,
      items: [
        item({ id: 'a', status: 'downloading' }),
        item({ id: 'b', status: 'paused' }),
        item({ id: 'c', status: 'queued' }),
        item({ id: 'd', status: 'completed' }),
        item({ id: 'e', status: 'cancelled' })
      ]
    }
    const rec = recoverStore(store)
    expect(rec.items.find((i) => i.id === 'a')!.status).toBe('failed')
    expect(rec.items.find((i) => i.id === 'a')!.errorCode).toBe('interrupted')
    expect(rec.items.find((i) => i.id === 'b')!.status).toBe('failed')
    expect(rec.items.find((i) => i.id === 'c')!.status).toBe('failed')
    expect(rec.items.find((i) => i.id === 'd')!.status).toBe('completed')
    expect(rec.items.find((i) => i.id === 'e')!.status).toBe('cancelled')
  })
})

describe('normalizeDownloads (persistence migration)', () => {
  it('returns empty store on corrupt input', () => {
    expect(normalizeDownloads('not json').items).toEqual([])
    expect(normalizeDownloads(null).items).toEqual([])
    expect(normalizeDownloads({ version: 1, items: [{ bogus: true }] }).items).toEqual([])
  })
  it('keeps valid items', () => {
    const store = { version: 1, items: [item({ id: 'x' })] }
    expect(normalizeDownloads(store).items).toHaveLength(1)
  })
})

describe('summarize', () => {
  it('counts by status', () => {
    const s = summarize([
      item({ status: 'downloading' }),
      item({ status: 'queued' }),
      item({ status: 'completed' }),
      item({ status: 'failed' }),
      item({ status: 'cancelled' })
    ])
    expect(s).toMatchObject({ active: 1, queued: 1, completed: 1, failed: 2, total: 5 })
  })
})

describe('redactUrl (privacy)', () => {
  it('masks known secret query params for logging', () => {
    const r = redactUrl('https://cdn.example.com/f.zip?token=abc123&X-Amz-Signature=xyz&plain=1')
    expect(r).not.toContain('abc123')
    expect(r).not.toContain('xyz')
    expect(r).toContain('plain=1')
  })
})
