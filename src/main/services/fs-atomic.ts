import { existsSync, readFileSync, renameSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'

/**
 * Crash-safe JSON write: serialize -> write temp -> keep previous as .bak ->
 * atomic rename. An interrupted write never corrupts the live file, and a
 * previous valid copy remains recoverable via .bak.
 */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = path + '.tmp'
  const bak = path + '.bak'
  const serialized = JSON.stringify(data, null, 2)
  // Validate we produced parseable output before touching the live file.
  JSON.parse(serialized)
  writeFileSync(tmp, serialized, { mode: 0o600 })
  if (existsSync(path)) {
    try {
      copyFileSync(path, bak)
    } catch {
      /* best-effort backup */
    }
  }
  renameSync(tmp, path)
}

/**
 * Read JSON with recovery: if the primary file is missing or corrupted, try
 * the .bak sidecar. Returns fallback when neither is usable. Never throws.
 */
export function readJsonSafe<T>(path: string, fallback: T): T {
  const tryRead = (p: string): T | undefined => {
    if (!existsSync(p)) return undefined
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T
    } catch {
      return undefined
    }
  }
  const primary = tryRead(path)
  if (primary !== undefined) return primary
  const backup = tryRead(path + '.bak')
  if (backup !== undefined) {
    // Restore the good backup into place.
    try {
      copyFileSync(path + '.bak', path)
    } catch {
      /* ignore */
    }
    return backup
  }
  // Remove an unreadable stub so future writes start clean.
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
  return fallback
}
