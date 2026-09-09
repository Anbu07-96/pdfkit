import "server-only";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/** promisify loses the options overload — wrap it explicitly. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing for credentials authentication (Phase 65).
 *
 * scrypt from node:crypto — memory-hard, zero native dependencies (keeps the
 * zero-native-binary architecture; no bcrypt/argon2 native addons).
 *
 * Storage format: `scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>`
 * Comparison is constant-time via timingSafeEqual.
 */

const SCRYPT_N = 16384; // CPU/memory cost (16 MB)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, { N, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
