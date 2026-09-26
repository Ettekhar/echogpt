import { hashRefreshToken } from './token-hash.util';

describe('token-hash.util', () => {
  beforeEach(() => {
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  it('is deterministic for the same token and secret', () => {
    const token = 'some.jwt.refresh.token';
    expect(hashRefreshToken(token)).toEqual(hashRefreshToken(token));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashRefreshToken('token-a')).not.toEqual(hashRefreshToken('token-b'));
  });

  it('never returns the plaintext token itself', () => {
    const token = 'a-refresh-token-value';
    expect(hashRefreshToken(token)).not.toEqual(token);
  });

  it('changes output if the secret changes (defense in depth)', () => {
    const token = 'same-token';
    const hash1 = hashRefreshToken(token);
    process.env.JWT_REFRESH_SECRET = 'a-different-secret';
    const hash2 = hashRefreshToken(token);
    expect(hash1).not.toEqual(hash2);
  });
});
