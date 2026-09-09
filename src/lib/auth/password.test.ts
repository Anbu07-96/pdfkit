// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("scrypt password hashing (Phase 65)", () => {
  it("hashes deterministically-salted and verifies the right password", async () => {
    const hash = await hashPassword("SecurePass2026");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("SecurePass2026", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("SecurePass2026");
    expect(await verifyPassword("SecurePass2027", hash)).toBe(false);
  });

  it("produces a different hash for the same password (random salt)", async () => {
    const a = await hashPassword("SecurePass2026");
    const b = await hashPassword("SecurePass2026");
    expect(a).not.toBe(b);
    expect(await verifyPassword("SecurePass2026", a)).toBe(true);
    expect(await verifyPassword("SecurePass2026", b)).toBe(true);
  });

  it("handles unicode passwords consistently (NFKC normalization)", async () => {
    const hash = await hashPassword("Pässwörd2026ü");
    expect(await verifyPassword("Pässwörd2026ü", hash)).toBe(true);
    expect(await verifyPassword("Password2026u", hash)).toBe(false);
  });

  it("rejects malformed/absent stored hashes without throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", undefined)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt:bad:bad:bad:zz:zz")).toBe(false);
    expect(await verifyPassword("x", "scrypt:16384:8:1::00")).toBe(false);
  });

  it("never embeds the plaintext password in the hash", async () => {
    const hash = await hashPassword("SecretPlaintext99");
    expect(hash.includes("SecretPlaintext99")).toBe(false);
  });
});
