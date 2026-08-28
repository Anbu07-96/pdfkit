import { describe, expect, it } from "vitest";
import {
  MAX_UNLOCK_PASSWORD_LENGTH,
  parseUnlockPdfOptions,
} from "@/lib/processing/unlock-pdf";

describe("parseUnlockPdfOptions", () => {
  it("accepts a password exactly as typed", () => {
    const result = parseUnlockPdfOptions({ password: "  Mixed Case 7 " });
    expect(result).toEqual({
      ok: true,
      options: { password: "  Mixed Case 7 " },
    });
  });

  it("treats a missing field as an empty password", () => {
    expect(parseUnlockPdfOptions({})).toEqual({
      ok: true,
      options: { password: "" },
    });
    expect(parseUnlockPdfOptions({ password: "" })).toEqual({
      ok: true,
      options: { password: "" },
    });
  });

  it("rejects an overlong entry", () => {
    const result = parseUnlockPdfOptions({
      password: "x".repeat(MAX_UNLOCK_PASSWORD_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.message).toContain(String(MAX_UNLOCK_PASSWORD_LENGTH));
    }
  });

  it("accepts the length boundary", () => {
    expect(
      parseUnlockPdfOptions({
        password: "x".repeat(MAX_UNLOCK_PASSWORD_LENGTH),
      }).ok,
    ).toBe(true);
  });
});
