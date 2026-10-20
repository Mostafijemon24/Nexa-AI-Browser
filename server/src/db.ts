/**
 * Gateway persistence (SQLite via Node's built-in `node:sqlite`).
 *
 * Minimal schema:
 *   users                 — anonymous NEXA AI accounts (one per app install/profile)
 *   devices               — device sessions; only a SHA-256 of the bearer token
 *   provider_connections  — BYOK credentials, AES-256-GCM ciphertext only
 *   usage_daily           — per-user, per-day, per-mode counters (quota)
 *   usage_bucket_daily    — per-IP-hash and global free-tier counters
 *   audit_log             — request metadata; never prompts, outputs or keys
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { AIMode } from '../../src/shared/ai-gateway'

export interface DeviceRecord {
  id: string
  userId: string
  expiresAt: number
  revokedAt: number | null
  userStatus: string
}

export interface ConnectionRecord {
  userId: string
  provider: string
  ciphertext: Uint8Array
  iv: Uint8Array
  tag: Uint8Array
  keyVersion: number
  keyHint: string | null
  createdAt: number
  lastValidatedAt: number | null
}

export interface UsageRow {
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface AuditEntry {
  userId?: string | null
  deviceId?: string | null
  ipHash?: string | null
  event: string
  mode?: string | null
  model?: string | null
  status: number
  errorCode?: string | null
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
}

const SCHEMA_VERSION = 2

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  platform TEXT,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS provider_connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  tag BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  key_hint TEXT,
  created_at INTEGER NOT NULL,
  last_validated_at INTEGER,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('free','premium')),
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, mode)
);
CREATE TABLE IF NOT EXISTS usage_bucket_daily (
  bucket TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, day)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id TEXT,
  device_id TEXT,
  ip_hash TEXT,
  event TEXT NOT NULL,
  mode TEXT,
  model TEXT,
  status INTEGER NOT NULL,
  error_code TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit_log(ts);
`

export class GatewayStore {
  private db: DatabaseSync
  private s: Record<string, StatementSync>

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
    const v = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
    if (!v) this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
    else if (v.version < SCHEMA_VERSION) this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
    const p = (sql: string) => this.db.prepare(sql)
    this.s = {
      insertUser: p('INSERT INTO users (id, created_at) VALUES (?, ?)'),
      insertDevice: p(
        'INSERT INTO devices (id, user_id, token_hash, platform, app_version, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      deviceByHash: p(
        'SELECT d.id, d.user_id, d.expires_at, d.revoked_at, u.status FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?'
      ),
      touchDevice: p('UPDATE devices SET last_seen_at = ?, expires_at = ? WHERE id = ?'),
      revokeDevice: p('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
      upsertConnection: p(
        `INSERT INTO provider_connections (user_id, provider, ciphertext, iv, tag, key_version, key_hint, created_at, last_validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
           key_version = excluded.key_version, key_hint = excluded.key_hint, last_validated_at = excluded.last_validated_at`
      ),
      getConnection: p('SELECT * FROM provider_connections WHERE user_id = ? AND provider = ?'),
      deleteConnection: p('DELETE FROM provider_connections WHERE user_id = ? AND provider = ?'),
      touchConnection: p('UPDATE provider_connections SET last_validated_at = ? WHERE user_id = ? AND provider = ?'),
      ensureUsage: p('INSERT OR IGNORE INTO usage_daily (user_id, day, mode) VALUES (?, ?, ?)'),
      reserveUsage: p('UPDATE usage_daily SET requests = requests + 1 WHERE user_id = ? AND day = ? AND mode = ? AND requests < ?'),
      refundUsage: p('UPDATE usage_daily SET requests = MAX(requests - 1, 0) WHERE user_id = ? AND day = ? AND mode = ?'),
      addTokens: p('UPDATE usage_daily SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND day = ? AND mode = ?'),
      ensureBucket: p('INSERT OR IGNORE INTO usage_bucket_daily (bucket, day) VALUES (?, ?)'),
      reserveBucket: p('UPDATE usage_bucket_daily SET requests = requests + 1 WHERE bucket = ? AND day = ? AND requests < ?'),
      refundBucket: p('UPDATE usage_bucket_daily SET requests = MAX(requests - 1, 0) WHERE bucket = ? AND day = ?'),
      getUsage: p('SELECT requests, input_tokens, output_tokens FROM usage_daily WHERE user_id = ? AND day = ? AND mode = ?'),
      insertAudit: p(
        `INSERT INTO audit_log (ts, user_id, device_id, ip_hash, event, mode, model, status, error_code, input_tokens, output_tokens, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      pruneAudit: p('DELETE FROM audit_log WHERE ts < ?'),
      pruneDevices: p('DELETE FROM devices WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)'),
      pruneUsage: p('DELETE FROM usage_daily WHERE day < ?'),
      pruneBuckets: p('DELETE FROM usage_bucket_daily WHERE day < ?'),
      // Accounts with no remaining device session are unreachable; drop them (cascades BYOK rows).
      pruneOrphanUsers: p('DELETE FROM users WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = users.id)')
    }
  }

  close(): void {
    this.db.close()
  }

  /** Atomically create an anonymous user and its first device session. */
  createUserWithDevice(input: { userId: string; deviceId: string; tokenHash: string; platform?: string; appVersion?: string; now: number; expiresAt: number }): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.s.insertUser.run(input.userId, input.now)
      this.s.insertDevice.run(input.deviceId, input.userId, input.tokenHash, input.platform ?? null, input.appVersion ?? null, input.now, input.now, input.expiresAt)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  deviceByTokenHash(tokenHash: string): DeviceRecord | null {
    const r = this.s.deviceByHash.get(tokenHash) as
      | { id: string; user_id: string; expires_at: number; revoked_at: number | null; status: string }
      | undefined
    if (!r) return null
    return { id: r.id, userId: r.user_id, expiresAt: r.expires_at, revokedAt: r.revoked_at, userStatus: r.status }
  }

  touchDevice(deviceId: string, now: number, expiresAt: number): void {
    this.s.touchDevice.run(now, expiresAt, deviceId)
  }

  revokeDevice(deviceId: string, now: number): void {
    this.s.revokeDevice.run(now, deviceId)
  }

  upsertConnection(c: Omit<ConnectionRecord, 'createdAt'> & { now: number }): void {
    this.s.upsertConnection.run(c.userId, c.provider, c.ciphertext, c.iv, c.tag, c.keyVersion, c.keyHint, c.now, c.lastValidatedAt)
  }

  getConnection(userId: string, provider: string): ConnectionRecord | null {
    const r = this.s.getConnection.get(userId, provider) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      userId: r.user_id as string,
      provider: r.provider as string,
      ciphertext: r.ciphertext as Uint8Array,
      iv: r.iv as Uint8Array,
      tag: r.tag as Uint8Array,
      keyVersion: r.key_version as number,
      keyHint: (r.key_hint as string | null) ?? null,
      createdAt: r.created_at as number,
      lastValidatedAt: (r.last_validated_at as number | null) ?? null
    }
  }

  deleteConnection(userId: string, provider: string): boolean {
    return Number(this.s.deleteConnection.run(userId, provider).changes) > 0
  }

  touchConnection(userId: string, provider: string, now: number): void {
    this.s.touchConnection.run(now, userId, provider)
  }

  /** Atomically consume one request from today's quota. False when exhausted. */
  reserveDaily(userId: string, day: string, mode: AIMode, limit: number): boolean {
    this.s.ensureUsage.run(userId, day, mode)
    return Number(this.s.reserveUsage.run(userId, day, mode, limit).changes) === 1
  }

  refundDaily(userId: string, day: string, mode: AIMode): void {
    this.s.refundUsage.run(userId, day, mode)
  }

  /** Atomically consume one request from a shared daily bucket (per-IP / global). */
  reserveBucket(bucket: string, day: string, limit: number): boolean {
    this.s.ensureBucket.run(bucket, day)
    return Number(this.s.reserveBucket.run(bucket, day, limit).changes) === 1
  }

  refundBucket(bucket: string, day: string): void {
    this.s.refundBucket.run(bucket, day)
  }

  addTokens(userId: string, day: string, mode: AIMode, input: number, output: number): void {
    this.s.addTokens.run(Math.max(0, Math.floor(input)), Math.max(0, Math.floor(output)), userId, day, mode)
  }

  usage(userId: string, day: string, mode: AIMode): UsageRow {
    const r = this.s.getUsage.get(userId, day, mode) as { requests: number; input_tokens: number; output_tokens: number } | undefined
    return { requests: r?.requests ?? 0, inputTokens: r?.input_tokens ?? 0, outputTokens: r?.output_tokens ?? 0 }
  }

  audit(e: AuditEntry, now: number): void {
    this.s.insertAudit.run(
      now,
      e.userId ?? null,
      e.deviceId ?? null,
      e.ipHash ?? null,
      e.event,
      e.mode ?? null,
      e.model ?? null,
      e.status,
      e.errorCode ?? null,
      e.inputTokens ?? null,
      e.outputTokens ?? null,
      e.latencyMs ?? null
    )
  }

  prune(now: number, auditRetentionMs: number): void {
    this.s.pruneAudit.run(now - auditRetentionMs)
    this.s.pruneDevices.run(now, now - 7 * 86_400_000)
    const cutoffDay = new Date(now - 40 * 86_400_000).toISOString().slice(0, 10)
    this.s.pruneUsage.run(cutoffDay)
    this.s.pruneBuckets.run(cutoffDay)
    this.s.pruneOrphanUsers.run(now - 86_400_000)
  }

  /** Test/ops helper: raw rows for assertions (never exposed over HTTP). */
  rawConnectionRow(userId: string, provider: string): Record<string, unknown> | undefined {
    return this.s.getConnection.get(userId, provider) as Record<string, unknown> | undefined
  }

  rawAuditRows(): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM audit_log ORDER BY id').all() as Record<string, unknown>[]
  }
}
