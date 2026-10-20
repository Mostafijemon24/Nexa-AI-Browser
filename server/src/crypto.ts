/**
 * Server-side credential encryption (AES-256-GCM, authenticated).
 *
 * The master key exists only in the server environment. Ciphertexts are bound
 * to their owner + provider via AAD, so a row copied to another user fails to
 * decrypt.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const KEY_VERSION = 1

export interface Sealed {
  ciphertext: Buffer
  iv: Buffer
  tag: Buffer
  keyVersion: number
}

function aad(userId: string, provider: string, version: number): Buffer {
  return Buffer.from(`nexa:byok:v${version}:${userId}:${provider}`, 'utf8')
}

export function sealCredential(masterKey: Buffer, userId: string, provider: string, plaintext: string): Sealed {
  if (masterKey.length !== 32) throw new Error('invalid_master_key')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  cipher.setAAD(aad(userId, provider, KEY_VERSION))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: KEY_VERSION }
}

export function openCredential(
  masterKey: Buffer,
  userId: string,
  provider: string,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array; keyVersion: number }
): string {
  if (sealed.keyVersion !== KEY_VERSION) throw new Error('unsupported_key_version')
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(sealed.iv))
  decipher.setAAD(aad(userId, provider, sealed.keyVersion))
  decipher.setAuthTag(Buffer.from(sealed.tag))
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext)), decipher.final()]).toString('utf8')
}

/** Bearer tokens are stored only as SHA-256 digests. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function newToken(): string {
  return 'nxa_' + randomBytes(32).toString('base64url')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Masked hint for display: last 4 characters only. */
export function keyHint(key: string): string {
  return '…' + key.slice(-4)
}
