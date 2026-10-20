import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* --------------------------- fake electron --------------------------- */

const hoisted = vi.hoisted(() => {
  const { EventEmitter: EE } = require('node:events')
  class FakeSession extends EE {
    downloadURL = vi.fn()
  }
  const sessions = new Map<string, InstanceType<typeof FakeSession>>()
  const shellMock = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
  return { FakeSession, sessions, shellMock }
})
const { sessions, shellMock } = hoisted

vi.mock('electron', () => ({
  session: {
    fromPartition: (name: string) => {
      if (!hoisted.sessions.has(name)) hoisted.sessions.set(name, new hoisted.FakeSession())
      return hoisted.sessions.get(name)!
    },
    defaultSession: new (require('node:events').EventEmitter)()
  },
  shell: hoisted.shellMock
}))
void shellMock

/* fake DownloadItem mimicking Electron.DownloadItem */
class FakeItem extends EventEmitter {
  private _received = 0
  private _paused = false
  private _savePath = ''
  constructor(
    private _url: string,
    private _filename: string,
    private _total: number,
    private _mime = 'application/octet-stream'
  ) {
    super()
  }
  getURL() { return this._url }
  getFilename() { return this._filename }
  getMimeType() { return this._mime }
  getTotalBytes() { return this._total }
  getReceivedBytes() { return this._received }
  getStartTime() { return Date.now() / 1000 }
  getSavePath() { return this._savePath }
  setSavePath(p: string) { this._savePath = p }
  isPaused() { return this._paused }
  canResume() { return true }
  pause() { this._paused = true }
  resume() { this._paused = false }
  cancel() { this.emit('done', {}, 'cancelled') }
  // test helpers
  progress(received: number) { this._received = received; this.emit('updated', {}, 'progressing') }
  finish(received: number) { this._received = received; this.emit('done', {}, 'completed') }
  fail() { this.emit('done', {}, 'interrupted') }
}

import { DownloadService } from '../../src/main/services/downloads'
import { Persistence } from '../../src/main/services/persistence'
import type { PlatformAdapter } from '../../src/platform/types'

let root: string
function fakePlatform(): PlatformAdapter {
  return {
    kind: 'linux',
    appDataDir: () => root,
    profileDir: (id: string) => join(root, 'profiles', id),
    downloadsDir: () => join(root, 'downloads'),
    notify: () => {},
    openPath: async () => ''
  }
}

function trigger(service: DownloadService, profileId: string, item: FakeItem, isPrivate = false) {
  const part = isPrivate ? `nexa-private-${profileId}` : `persist:nexa-${profileId}`
  sessions.get(part)!.emit('will-download', {}, item)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-dl-'))
  sessions.clear()
  mkdirSync(join(root, 'downloads'), { recursive: true })
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('DownloadService — detection + lifecycle', () => {
  it('detects a browser download, tracks progress, completes and persists', () => {
    const persist = new Persistence(fakePlatform())
    const service = new DownloadService(persist, () => {}, () => {})
    service.attachForProfiles(['alpha'])

    const item = new FakeItem('https://cdn.example.com/report.pdf', 'report.pdf', 1000)
    trigger(service, 'alpha', item)

    let list = service.list('alpha')
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('downloading')
    expect(list[0].filename).toBe('report.pdf')
    expect(list[0].mimeType).toBe('application/octet-stream')

    item.progress(500)
    // Create the real file so the completion existence check passes.
    writeFileSync(list[0].savePath!, 'x'.repeat(1000))
    item.finish(1000)

    list = service.list('alpha')
    expect(list[0].status).toBe('completed')
    expect(list[0].receivedBytes).toBe(1000)
    expect(list[0].completedAt).toBeDefined()

    // Persisted across a simulated restart.
    const service2 = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    const reloaded = service2.list('alpha')
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].status).toBe('completed')
  })

  it('marks completion as failed when the file is missing', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/y.bin', 'y.bin', 10)
    trigger(service, 'alpha', item)
    item.finish(10) // no file written
    expect(service.list('alpha')[0].status).toBe('failed')
    expect(service.list('alpha')[0].errorCode).toBe('file_missing')
  })

  it('sanitizes server filenames and dedupes within the destination', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])

    const a = new FakeItem('https://x/a', '../../evil.txt', 5)
    trigger(service, 'alpha', a)
    const first = service.list('alpha')[0]
    expect(first.filename).toBe('evil.txt')
    writeFileSync(first.savePath!, 'x'.repeat(5))
    a.finish(5)

    const b = new FakeItem('https://x/b', 'evil.txt', 5)
    trigger(service, 'alpha', b)
    const names = service.list('alpha').map((d) => d.filename)
    expect(names).toContain('evil (1).txt')
  })
})

describe('DownloadService — queue + concurrency', () => {
  it('queues downloads beyond the concurrency limit and promotes them', () => {
    const persist = new Persistence(fakePlatform())
    const service = new DownloadService(persist, () => {}, () => {})
    service.attachForProfiles(['alpha'])
    service.saveSettings('alpha', { askLocation: false, duplicatePolicy: 'rename', maxConcurrent: 1, retryLimit: 3 })

    const a = new FakeItem('https://x/a.bin', 'a.bin', 100)
    const b = new FakeItem('https://x/b.bin', 'b.bin', 100)
    trigger(service, 'alpha', a)
    trigger(service, 'alpha', b)

    const list = service.list('alpha')
    const recA = list.find((d) => d.filename === 'a.bin')!
    const recB = list.find((d) => d.filename === 'b.bin')!
    expect(recA.status).toBe('downloading')
    expect(recB.status).toBe('queued')
    expect(b.isPaused()).toBe(true)

    // Complete A -> B should be promoted and resumed.
    writeFileSync(recA.savePath!, 'x'.repeat(100))
    a.finish(100)
    const after = service.list('alpha')
    expect(after.find((d) => d.filename === 'b.bin')!.status).toBe('downloading')
    expect(b.isPaused()).toBe(false)
  })
})

describe('DownloadService — pause / resume / cancel / retry', () => {
  it('pauses and resumes an active download at the engine level', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/big.iso', 'big.iso', 1000)
    trigger(service, 'alpha', item)
    const id = service.list('alpha')[0].id

    service.pause('alpha', id)
    expect(item.isPaused()).toBe(true)
    expect(service.list('alpha')[0].status).toBe('paused')

    service.resume('alpha', id)
    expect(item.isPaused()).toBe(false)
    expect(service.list('alpha')[0].status).toBe('downloading')
  })

  it('cancels an active download', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/big.iso', 'big.iso', 1000)
    trigger(service, 'alpha', item)
    const id = service.list('alpha')[0].id
    service.cancel('alpha', id)
    expect(service.list('alpha')[0].status).toBe('cancelled')
  })

  it('retries a failed download by re-initiating via the session', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/f.zip', 'f.zip', 100)
    trigger(service, 'alpha', item)
    const id = service.list('alpha')[0].id
    item.fail()
    expect(service.list('alpha')[0].status).toBe('failed')

    service.retry('alpha', id)
    const rec = service.list('alpha')[0]
    expect(rec.retryCount).toBe(1)
    expect(rec.status).toBe('queued')
    expect(sessions.get('persist:nexa-alpha')!.downloadURL).toHaveBeenCalledWith('https://x/f.zip')
  })

  it('enforces the retry limit', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    service.saveSettings('alpha', { askLocation: false, duplicatePolicy: 'rename', maxConcurrent: 4, retryLimit: 0 })
    const item = new FakeItem('https://x/f.zip', 'f.zip', 100)
    trigger(service, 'alpha', item)
    const id = service.list('alpha')[0].id
    item.fail()
    expect(() => service.retry('alpha', id)).toThrow('retry_limit')
  })

  it('remove never deletes the file and drops the record', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/f.zip', 'f.zip', 100)
    trigger(service, 'alpha', item)
    const rec = service.list('alpha')[0]
    writeFileSync(rec.savePath!, 'x'.repeat(100))
    item.finish(100)
    service.remove('alpha', rec.id)
    expect(service.list('alpha')).toHaveLength(0)
    // File remains on disk (existence proves remove didn't delete it).
    expect(require('node:fs').existsSync(rec.savePath!)).toBe(true)
  })
})

describe('DownloadService — profile isolation + private downloads', () => {
  it('keeps download lists isolated per profile', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha', 'beta'])
    trigger(service, 'alpha', new FakeItem('https://x/a', 'a.bin', 1))
    trigger(service, 'beta', new FakeItem('https://x/b', 'b.bin', 1))
    expect(service.list('alpha').map((d) => d.filename)).toEqual(['a.bin'])
    expect(service.list('beta').map((d) => d.filename)).toEqual(['b.bin'])
  })

  it('does not persist private downloads across a restart', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/secret.bin', 'secret.bin', 10)
    trigger(service, 'alpha', item, true)
    const rec = service.list('alpha')[0]
    expect(rec.private).toBe(true)
    writeFileSync(rec.savePath!, 'x'.repeat(10))
    item.finish(10)

    // New instance reads only what was persisted to disk — private is gone.
    const service2 = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    expect(service2.list('alpha')).toHaveLength(0)
  })
})

describe('DownloadService — restart recovery', () => {
  it('marks interrupted in-flight downloads as retryable failed on restart', () => {
    const service = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    service.attachForProfiles(['alpha'])
    const item = new FakeItem('https://x/big.iso', 'big.iso', 100000)
    trigger(service, 'alpha', item)
    item.progress(5000) // persisted as 'downloading'
    expect(service.list('alpha')[0].status).toBe('downloading')

    // Simulate restart.
    const service2 = new DownloadService(new Persistence(fakePlatform()), () => {}, () => {})
    const rec = service2.list('alpha')[0]
    expect(rec.status).toBe('failed')
    expect(rec.errorCode).toBe('interrupted')
  })
})
