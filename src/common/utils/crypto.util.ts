import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_SECRET is not configured');
  }
  // Accept either a 32-byte hex string or derive a 32-byte key from any secret.
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/** Encrypts a plaintext API key for storage. Returns "iv:authTag:ciphertext" (all hex). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value produced by encryptSecret.
 *
 * Throws a message that says what to do about it. Without this the raw OpenSSL
 * error ("Unsupported state or unable to authenticate data") escapes to the
 * client as a bare 500, which is useless to whoever has to fix it. That is not
 * hypothetical: a database seeded on one machine and then run by another holds
 * rows encrypted under a different PROVIDER_KEY_ENCRYPTION_SECRET, and the
 * first symptom anybody sees is a 500 on chat with no hint why.
 */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivHex, authTagHex, dataHex] = (payload || '').split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error(
      'Stored provider key is malformed. Re-add the API key for this provider in the AI Providers screen.',
    );
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // AES-GCM authenticates, so a wrong key fails the auth tag check exactly
    // like tampered ciphertext. The overwhelmingly common cause is a changed
    // PROVIDER_KEY_ENCRYPTION_SECRET rather than tampering, so say that.
    throw new Error(
      'Cannot decrypt the stored provider API key. PROVIDER_KEY_ENCRYPTION_SECRET does not match the one these keys were saved with - re-enter the key in the AI Providers screen, or restore the original secret.',
    );
  }
}

/** Masks a secret for display, e.g. "sk-abc...wxyz". */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '****';
  return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
}
