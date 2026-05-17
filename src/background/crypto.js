const subtle = globalThis.crypto.subtle

const SALT_BYTES = 16
const IV_BYTES = 12
const PBKDF2_ITERATIONS = 100_000
const AES_KEY_BITS = 256

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToBuf(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function getPasswordKey(passphrase) {
  const encoder = new TextEncoder()
  return subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
}

async function deriveKey(passwordKey, salt) {
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function encrypt(tree, passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const passwordKey = await getPasswordKey(passphrase)
  const key = await deriveKey(passwordKey, salt)

  const plaintext = new TextEncoder().encode(JSON.stringify(tree))
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    v: 1,
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    ct: bufToBase64(ciphertext),
  }
}

export async function decrypt(payload, passphrase) {
  const salt = base64ToBuf(payload.salt)
  const iv = base64ToBuf(payload.iv)
  const ct = base64ToBuf(payload.ct)

  const passwordKey = await getPasswordKey(passphrase)
  const key = await deriveKey(passwordKey, salt)

  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  const text = new TextDecoder().decode(decrypted)
  return JSON.parse(text)
}

export async function safeDecrypt(value, passphrase) {
  if (value === null || value === undefined) return null
  if (isPlainObject(value) && value.v === 1) {
    return decrypt(value, passphrase)
  }
  if (isPlainObject(value) && value.v === undefined) {
    return value
  }
  throw new Error('safeDecrypt: unsupported value type')
}
