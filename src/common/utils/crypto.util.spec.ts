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

  describe('maskSecret', () => {
    it('masks the middle of a long secret', () => {
      expect(maskSecret('sk-abcdefghijklmnopwxyz')).toBe('sk-a...wxyz');
    });

    it('fully masks short secrets', () => {
      expect(maskSecret('short')).toBe('****');
    });
  });
});
