import "server-only";

export interface FailedLoginRecord {
  count: number;
  lockoutUntil: number; // Unix timestamp ms
}

const failedLogins = new Map<string, FailedLoginRecord>();

export const MAX_UNLOCKED_FAILED_ATTEMPTS = 6;
export const INITIAL_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check whether an email address is currently locked out due to excessive failed attempts.
 */
export function checkLoginLockout(normalizedEmail: string): { isLocked: boolean; remainingSeconds?: number } {
  const record = failedLogins.get(normalizedEmail.toLowerCase());
  if (!record) return { isLocked: false };

  const now = Date.now();
  if (record.lockoutUntil > now) {
    const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
    return { isLocked: true, remainingSeconds };
  }

  // Lockout expired
  if (record.count >= MAX_UNLOCKED_FAILED_ATTEMPTS && record.lockoutUntil <= now) {
    failedLogins.delete(normalizedEmail.toLowerCase());
  }

  return { isLocked: false };
}

/**
 * Record a failed login attempt for an email address.
 * Triggers temporary lockout after 6 consecutive failures.
 */
export function recordFailedLogin(normalizedEmail: string): void {
  const emailKey = normalizedEmail.toLowerCase();
  const existing = failedLogins.get(emailKey) || { count: 0, lockoutUntil: 0 };
  const now = Date.now();

  const newCount = existing.count + 1;
  let lockoutUntil = existing.lockoutUntil;

  if (newCount >= MAX_UNLOCKED_FAILED_ATTEMPTS) {
    // Escalating backoff: 15 min * 2^(newCount - 6)
    const multiplier = Math.pow(2, Math.min(newCount - MAX_UNLOCKED_FAILED_ATTEMPTS, 4));
    lockoutUntil = now + INITIAL_LOCKOUT_MS * multiplier;
  }

  failedLogins.set(emailKey, { count: newCount, lockoutUntil });
}

/**
 * Clear failed login attempts upon successful authentication.
 */
export function clearFailedLogin(normalizedEmail: string): void {
  failedLogins.delete(normalizedEmail.toLowerCase());
}

/** Reset all failed login records (used for testing) */
export function resetFailedLoginTracker(): void {
  failedLogins.clear();
}
