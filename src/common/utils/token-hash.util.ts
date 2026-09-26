import * as crypto from 'crypto';

/**
 * Refresh tokens are high-entropy signed JWTs (not user-chosen secrets), so a fast,
 * deterministic HMAC-SHA256 is appropriate here (unlike passwords, which need bcrypt's
 * slow, salted hashing). Using an HMAC keyed on JWT_REFRESH_SECRET means a stolen copy
 * of the `Session` table alone doesn't hand over live sessions.
 */
export function hashRefreshToken(token: string): string {
  const secret = process.env.JWT_REFRESH_SECRET || 'fallback-secret-set-JWT_REFRESH_SECRET';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}
