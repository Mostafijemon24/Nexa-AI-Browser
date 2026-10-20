import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

function secretsPath() {
  return join(app.getPath('userData'), 'secure', 'secrets.bin.json')
}

function ensureDir() {
  mkdirSync(join(app.getPath('userData'), 'secure'), { recursive: true })
}

export class SecureStorage {
  available() {
    return safeStorage.isEncryptionAvailable()
  }

  set(key: string, value: string) {
    if (!this.available()) throw new Error('secure_storage_unavailable')
    ensureDir()
    const map = this.readMap()
    map[key] = safeStorage.encryptString(value).toString('base64')
    writeFileSync(secretsPath(), JSON.stringify(map), { mode: 0o600 })
  }

  get(key: string): string | null {
    if (!this.available()) return null
    const map = this.readMap()
    const raw = map[key]
    if (!raw) return null
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    } catch {
      return null
    }
  }

  delete(key: string) {
    const map = this.readMap()
    if (!(key in map)) return
    delete map[key]
    writeFileSync(secretsPath(), JSON.stringify(map), { mode: 0o600 })
  }

  private readMap(): Record<string, string> {
    const p = secretsPath()
    if (!existsSync(p)) return {}
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  wipe() {
    const p = secretsPath()
    if (existsSync(p)) unlinkSync(p)
  }
}
