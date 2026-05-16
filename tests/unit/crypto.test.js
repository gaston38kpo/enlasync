import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, safeDecrypt } from '@/background/crypto.js'

describe('crypto', () => {
  const passphrase = 'my-test-passphrase'
  const tree = { title: '[SyncBookmarks]', children: [{ title: 'MDN', url: 'https://mdn.io' }] }

  describe('encrypt', () => {
    it('returns an envelope with v:1 and base64 salt, iv, ct', async () => {
      const result = await encrypt(tree, passphrase)

      expect(result).toBeDefined()
      expect(result.v).toBe(1)
      expect(typeof result.salt).toBe('string')
      expect(typeof result.iv).toBe('string')
      expect(typeof result.ct).toBe('string')
      // Base64 strings should be non-empty
      expect(result.salt.length).toBeGreaterThan(0)
      expect(result.iv.length).toBeGreaterThan(0)
      expect(result.ct.length).toBeGreaterThan(0)
      // They should decode to valid buffers
      expect(Buffer.from(result.salt, 'base64')).toBeInstanceOf(Buffer)
      expect(Buffer.from(result.iv, 'base64')).toBeInstanceOf(Buffer)
      expect(Buffer.from(result.ct, 'base64')).toBeInstanceOf(Buffer)
    })
  })

  describe('decrypt', () => {
    it('round-trips: decrypt(encrypt(tree)) returns original tree', async () => {
      const encrypted = await encrypt(tree, passphrase)
      const decrypted = await decrypt(encrypted, passphrase)

      expect(decrypted).toEqual(tree)
    })

    it('throws when passphrase is wrong', async () => {
      const encrypted = await encrypt(tree, passphrase)

      await expect(decrypt(encrypted, 'wrong-passphrase')).rejects.toThrow()
    })
  })

  describe('safeDecrypt', () => {
    it('returns null when value is null', async () => {
      const result = await safeDecrypt(null, passphrase)
      expect(result).toBeNull()
    })

    it('returns null when value is undefined', async () => {
      const result = await safeDecrypt(undefined, passphrase)
      expect(result).toBeNull()
    })

    it('passes through legacy plaintext object without v property', async () => {
      const legacy = { title: 'Legacy', children: [] }
      const result = await safeDecrypt(legacy, passphrase)
      expect(result).toEqual(legacy)
    })

    it('decrypts an encrypted envelope with v:1', async () => {
      const encrypted = await encrypt(tree, passphrase)
      const result = await safeDecrypt(encrypted, passphrase)
      expect(result).toEqual(tree)
    })

    it('throws on malformed encrypted string', async () => {
      await expect(safeDecrypt('not-an-object', passphrase)).rejects.toThrow()
    })

    it('throws on envelope with invalid base64 fields', async () => {
      const malformed = { v: 1, salt: 'bad', iv: 'bad', ct: 'bad' }
      await expect(safeDecrypt(malformed, passphrase)).rejects.toThrow()
    })
  })
})
