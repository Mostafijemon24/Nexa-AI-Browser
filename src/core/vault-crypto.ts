import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export const VAULT_ITERS = 210_000
export const VAULT_KEYLEN = 32

export interface VaultBlob {
  v: 1
  salt: string
  iters: number
  iv: string
  ct: string
  tag: string
}

export interface Credential {
  id: string
  title: string
  origin: string
  username: string
  password: string
  notes: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export function deriveKey(password: string, salt: Buffer, iters = VAULT_ITERS): Buffer {
  return pbkdf2Sync(password, salt, iters, VAULT_KEYLEN, 'sha256')
}

export function encryptVault(key: Buffer, creds: Credential[], salt: Buffer, iters: number): VaultBlob {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const pt = Buffer.from(JSON.stringify(creds), 'utf8')
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    salt: salt.toString('base64'),
    iters,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64')
  }
}

export function decryptVault(key: Buffer, blob: VaultBlob): Credential[] {
  const iv = Buffer.from(blob.iv, 'base64')
  const ct = Buffer.from(blob.ct, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  const parsed = JSON.parse(pt.toString('utf8')) as unknown
  if (!Array.isArray(parsed)) throw new Error('tampered_vault')
  return parsed as Credential[]
}

export function generatePassword(opts: {
  length: number
  upper: boolean
  lower: boolean
  num: boolean
  sym: boolean
  noAmbig: boolean
}): string {
  const U = opts.noAmbig ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const L = opts.noAmbig ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz'
  const N = opts.noAmbig ? '23456789' : '0123456789'
  const S = '!@#$%^&*()-_=+[]{}'
  let pool = ''
  if (opts.upper) pool += U
  if (opts.lower) pool += L
  if (opts.num) pool += N
  if (opts.sym) pool += S
  if (!pool) pool = L
  const arr = randomBytes(opts.length)
  let out = ''
  for (let i = 0; i < opts.length; i++) out += pool[arr[i] % pool.length]
  return out
}

export { passwordStrength } from '../shared/strength'
