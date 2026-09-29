import { encryptSecret, decryptSecret, maskSecret } from './crypto.util';

describe('crypto.util', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, PROVIDER_KEY_ENCRYPTION_SECRET: 'a'.repeat(64) };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('encrypts and decrypts back to the original plaintext', () => {
    const plaintext = 'sk-super-secret-api-key-12345';
    const encrypted = encryptSecret(plaintext);

    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const plaintext = 'sk-same-key-every-time';
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);
    expect(first).not.toEqual(second);
  });

  it('throws if PROVIDER_KEY_ENCRYPTION_SECRET is not configured', () => {
    delete process.env.PROVIDER_KEY_ENCRYPTION_SECRET;
    expect(() => encryptSecret('anything')).toThrow();
  });

  it('accepts a non-hex passphrase by deriving a key from it', () => {
    process.env.PROVIDER_KEY_ENCRYPTION_SECRET = 'not-a-hex-string-but-still-a-secret';
    const encrypted = encryptSecret('hello world');
    expect(decryptSecret(encrypted)).toEqual('hello world');
  });

  // A database created by one machine and then run by another (a shared .pgdata,
  // a restored dump) holds keys encrypted under a secret the new machine does not
  // have. OpenSSL reports that as "Unsupported state or unable to authenticate
  // data", which reached the user as a bare 500. These tests pin the message that
  // actually tells them what to do.
  describe('undecryptable payloads', () => {
    it('explains a secret mismatch instead of leaking the OpenSSL error', () => {
      const encrypted = encryptSecret('sk-secret');
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = 'b'.repeat(64);

      expect(() => decryptSecret(encrypted)).toThrow(/PROVIDER_KEY_ENCRYPTION_SECRET/);
      expect(() => decryptSecret(encrypted)).not.toThrow(/Unsupported state/);
    });

    it('reports tampered ciphertext rather than returning garbage', () => {
      const encrypted = encryptSecret('sk-secret');
      const [iv, tag, data] = encrypted.split(':');
      const flipped = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);

      expect(() => decryptSecret(`${iv}:${tag}:${flipped}`)).toThrow(
        /PROVIDER_KEY_ENCRYPTION_SECRET/,
      );
    });

    it('rejects a malformed payload with a re-add-the-key message', () => {
      expect(() => decryptSecret('not-even-close-to-valid')).toThrow(/Re-add the API key/);
      expect(() => decryptSecret('')).toThrow(/Re-add the API key/);
    });
  });

  describe('maskSecret', () => {
    it('masks the middle of a long secret', () => {
      expect(maskSecret('sk-abcdefghijklmnopwxyz')).toBe('sk-a...wxyz');
    });

    it('fully masks short secrets', () => {
      expect(maskSecret('short')).toBe('****');
    });
  });
});
