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
  const classes: string[] = []
  if (opts.upper) classes.push(U)
  if (opts.lower) classes.push(L)
  if (opts.num) classes.push(N)
  if (opts.sym) classes.push(S)
  if (!classes.length) classes.push(L)
  const pool = classes.join('')

  // Uniform selection with rejection sampling — avoids the modulo bias of
  // `byte % pool.length` (which skews toward lower code points when the pool
  // size does not divide 256) and keeps full entropy per character.
  const pickIndex = (n: number): number => {
    const limit = 256 - (256 % n) // largest multiple of n that fits in a byte
    for (;;) {
      const b = randomBytes(1)[0]
      if (b < limit) return b % n
    }
  }

  const out: string[] = []
  // Guarantee at least one character from each selected class (when length
  // allows), then fill the remainder from the full pool.
  for (const alphabet of classes) {
    if (out.length < opts.length) out.push(alphabet[pickIndex(alphabet.length)])
  }
  while (out.length < opts.length) out.push(pool[pickIndex(pool.length)])

  // Unbiased Fisher–Yates shuffle so the guaranteed characters are not fixed.
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

export { passwordStrength } from '../shared/strength'
