import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { clipboard } from 'electron'
import type { Persistence } from './persistence'
import type { SecureStorage } from './secure-storage'
import type { VaultMetaCredential } from '../../shared/types'
import {
  decryptVault,
  deriveKey,
  encryptVault,
  generatePassword,
  VAULT_ITERS,
  type Credential,
  type VaultBlob
} from '../../core/vault-crypto'

export { generatePassword }
export type { Credential, VaultBlob }

function publicCred(c: Credential): VaultMetaCredential {
  const { password: _pw, ...rest } = c
  return rest
}

interface Unlocked {
  key: Buffer
  creds: Credential[]
  timer: NodeJS.Timeout | null
}

export class VaultService {
  private unlocked = new Map<string, Unlocked>()
  private clipTimer: NodeJS.Timeout | null = null

  constructor(
    private persist: Persistence,
    private secure: SecureStorage
  ) {}

  exists(profileId: string) {
    return existsSync(this.persist.vaultPath(profileId))
  }

  isUnlocked(profileId: string) {
    return this.unlocked.has(profileId)
  }

  status(profileId: string) {
    return { exists: this.exists(profileId), unlocked: this.isUnlocked(profileId) }
  }

  create(profileId: string, password: string, autoLockMins: number) {
    if (this.exists(profileId)) throw new Error('vault_exists')
    const salt = randomBytes(16)
    const key = deriveKey(password, salt)
    const blob = encryptVault(key, [], salt, VAULT_ITERS)
    writeFileSync(this.persist.vaultPath(profileId), JSON.stringify(blob), { mode: 0o600 })
    this.hold(profileId, key, [], autoLockMins)
    this.sealKey(profileId, key)
    return this.list(profileId)
  }

  unlock(profileId: string, password: string, autoLockMins: number) {
    const path = this.persist.vaultPath(profileId)
    if (!existsSync(path)) throw new Error('vault_missing')
    let blob: VaultBlob
    try {
      blob = JSON.parse(readFileSync(path, 'utf8')) as VaultBlob
    } catch {
      throw new Error('tampered_vault')
    }
    if (!blob?.salt || !blob?.iv || !blob?.ct || !blob?.tag) throw new Error('tampered_vault')
    const salt = Buffer.from(blob.salt, 'base64')
    const key = deriveKey(password, salt, blob.iters || VAULT_ITERS)
    let creds: Credential[]
    try {
      creds = decryptVault(key, blob)
    } catch {
      throw new Error('incorrect_password')
    }
    this.hold(profileId, key, creds, autoLockMins)
    this.sealKey(profileId, key)
    return this.list(profileId)
  }

  lock(profileId: string) {
    const u = this.unlocked.get(profileId)
    if (u?.timer) clearTimeout(u.timer)
    this.unlocked.delete(profileId)
    this.secure.delete(`vault-key:${profileId}`)
  }

  lockAll() {
    for (const id of [...this.unlocked.keys()]) this.lock(id)
  }

  list(profileId: string): VaultMetaCredential[] {
    const u = this.require(profileId)
    return u.creds.map(publicCred)
  }

  reveal(profileId: string, id: string): string {
    const c = this.require(profileId).creds.find((x) => x.id === id)
    if (!c) throw new Error('not_found')
    return c.password
  }

  save(profileId: string, draft: { origin: string; username: string; password: string; title?: string; notes?: string }) {
    const u = this.require(profileId)
    const now = Date.now()
    const cred: Credential = {
      id: 'c' + now,
      title: draft.title || draft.origin,
      origin: draft.origin,
      username: draft.username,
      password: draft.password,
      notes: draft.notes || '',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null
    }
    u.creds = [...u.creds, cred]
    this.flush(profileId)
    return publicCred(cred)
  }

  update(profileId: string, draft: Partial<Credential> & { id: string }) {
    const u = this.require(profileId)
    u.creds = u.creds.map((c) =>
      c.id === draft.id
        ? {
            ...c,
            title: draft.title ?? c.title,
            origin: draft.origin ?? c.origin,
            username: draft.username ?? c.username,
            password: draft.password ?? c.password,
            notes: draft.notes ?? c.notes,
            updatedAt: Date.now()
          }
        : c
    )
    this.flush(profileId)
    return this.list(profileId)
  }

  delete(profileId: string, id: string) {
    const u = this.require(profileId)
    u.creds = u.creds.filter((c) => c.id !== id)
    this.flush(profileId)
    return this.list(profileId)
  }

  async copySecret(profileId: string, id: string) {
    const pw = this.reveal(profileId, id)
    // Electron 44+: clipboard methods are async (Promise-based).
    await clipboard.writeText(pw)
    if (this.clipTimer) clearTimeout(this.clipTimer)
    this.clipTimer = setTimeout(() => {
      // Only clear if the clipboard still holds the secret we wrote.
      void clipboard
        .readText()
        .then((current) => {
          if (current === pw) return clipboard.writeText('')
          return undefined
        })
        .catch(() => {
          /* ignore */
        })
    }, 30_000)
  }

  private require(profileId: string) {
    const u = this.unlocked.get(profileId)
    if (!u) throw new Error('vault_locked')
    return u
  }

  private hold(profileId: string, key: Buffer, creds: Credential[], autoLockMins: number) {
    const prev = this.unlocked.get(profileId)
    if (prev?.timer) clearTimeout(prev.timer)
    const entry: Unlocked = { key, creds, timer: null }
    if (autoLockMins > 0) {
      entry.timer = setTimeout(() => this.lock(profileId), autoLockMins * 60_000)
    }
    this.unlocked.set(profileId, entry)
  }

  private flush(profileId: string) {
    const u = this.require(profileId)
    const path = this.persist.vaultPath(profileId)
    const prev = JSON.parse(readFileSync(path, 'utf8')) as VaultBlob
    const salt = Buffer.from(prev.salt, 'base64')
    const blob = encryptVault(u.key, u.creds, salt, prev.iters || VAULT_ITERS)
    writeFileSync(path, JSON.stringify(blob), { mode: 0o600 })
  }

  private sealKey(profileId: string, key: Buffer) {
    if (!this.secure.available()) return
    try {
      this.secure.set(`vault-key:${profileId}`, key.toString('base64'))
    } catch {
      /* memory-only key still works while unlocked */
    }
  }
}
