import { randomBytes } from 'node:crypto'
import { deriveKey, encryptVault, decryptVault, generatePassword, passwordStrength } from '../../src/core/vault-crypto'
import { PROFILE_ID_RE } from '../../src/shared/types'
import { profileIdSchema } from '../../src/shared/ipc'
import { describe, expect, it } from 'vitest'

describe('vault crypto', () => {
  it('round-trips credentials and never stores plaintext', () => {
    const salt = randomBytes(16)
    const key = deriveKey('correct horse battery staple!', salt)
    const creds = [
      {
        id: 'c1',
        title: 'Example',
        origin: 'https://example.com',
        username: 'ada',
        password: 's3cret',
        notes: '',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null
      }
    ]
    const blob = encryptVault(key, creds, salt, 210000)
    const packed = JSON.stringify(blob)
    expect(packed).not.toContain('s3cret')
    expect(packed).not.toContain('ada')
    expect(packed).not.toContain('example.com')
    const out = decryptVault(key, blob)
    expect(out[0].password).toBe('s3cret')
  })

  it('detects tampering', () => {
    const salt = randomBytes(16)
    const key = deriveKey('pw-long-enough', salt)
    const blob = encryptVault(key, [], salt, 210000)
    blob.ct = Buffer.from('deadbeef', 'hex').toString('base64')
    expect(() => decryptVault(key, blob)).toThrow()
  })

  it('rejects a wrong password via decrypt failure', () => {
    const salt = randomBytes(16)
    const key = deriveKey('right-password-ok', salt)
    const blob = encryptVault(key, [], salt, 210000)
    const wrong = deriveKey('wrong-password-ok', salt)
    expect(() => decryptVault(wrong, blob)).toThrow()
  })

  it('generates from CSPRNG and scores strength', () => {
    const a = generatePassword({ length: 20, upper: true, lower: true, num: true, sym: true, noAmbig: true })
    const b = generatePassword({ length: 20, upper: true, lower: true, num: true, sym: true, noAmbig: true })
    expect(a).toHaveLength(20)
    expect(a).not.toBe(b)
    expect(passwordStrength('aaaaaaaa').label).toBe('Very weak')
    expect(passwordStrength('Tr0ub4dor&3x!aaaa').label).toMatch(/Strong/)
  })
})

describe('profile id validation', () => {
  it('accepts safe ids and rejects traversal / fake ids', () => {
    expect(PROFILE_ID_RE.test('research')).toBe(true)
    expect(PROFILE_ID_RE.test('../etc')).toBe(false)
    expect(PROFILE_ID_RE.test('a/b')).toBe(false)
    expect(profileIdSchema.safeParse('not a id!!').success).toBe(false)
    expect(profileIdSchema.safeParse('personal').success).toBe(true)
  })
})
