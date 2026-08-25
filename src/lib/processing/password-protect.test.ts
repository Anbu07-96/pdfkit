import { describe, expect, it } from "vitest";
import {
  isProtectPasswordAcceptable,
  MAX_PROTECT_PASSWORD_LENGTH,
  parsePasswordProtectOptions,
} from "@/lib/processing/password-protect";

describe("parsePasswordProtectOptions", () => {
  it("accepts a normal password exactly as typed", () => {
    const result = parsePasswordProtectOptions({ password: "S3cure! pass" });
    expect(result).toEqual({
      ok: true,
      options: { password: "S3cure! pass" },
    });
  });

  it("never trims or normalises: spaces and case are significant", () => {
    const result = parsePasswordProtectOptions({ password: "  Padded " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.password).toBe("  Padded ");
    }
  });

  it("rejects an empty or missing password", () => {
    for (const raw of [{}, { password: "" }, { password: undefined }]) {
      const result = parsePasswordProtectOptions(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.message).toMatch(/choose a password/i);
      }
    }
  });

  it("rejects a password that is too long", () => {
    const result = parsePasswordProtectOptions({
      password: "x".repeat(MAX_PROTECT_PASSWORD_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.message).toContain(
        String(MAX_PROTECT_PASSWORD_LENGTH),
      );
    }
  });

  it("accepts the boundaries", () => {
    expect(parsePasswordProtectOptions({ password: "x" }).ok).toBe(true);
    expect(
      parsePasswordProtectOptions({
        password: "x".repeat(MAX_PROTECT_PASSWORD_LENGTH),
      }).ok,
    ).toBe(true);
  });
});

describe("isProtectPasswordAcceptable", () => {
  it("mirrors the validation rule for the action button", () => {
    expect(isProtectPasswordAcceptable("")).toBe(false);
    expect(isProtectPasswordAcceptable("a")).toBe(true);
    expect(
      isProtectPasswordAcceptable("x".repeat(MAX_PROTECT_PASSWORD_LENGTH)),
    ).toBe(true);
    expect(
      isProtectPasswordAcceptable("x".repeat(MAX_PROTECT_PASSWORD_LENGTH + 1)),
    ).toBe(false);
  });
});
