import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginLockout,
  clearFailedLogin,
  recordFailedLogin,
  resetFailedLoginTracker,
} from "@/lib/auth/failed-login-tracker";

describe("Phase 54 — Server-Side Failed Login Tracking & Lockout", () => {
  const testEmail = "victim@gmail.com";

  beforeEach(() => {
    resetFailedLoginTracker();
  });

  afterEach(() => {
    resetFailedLoginTracker();
  });

  it("allows up to 5 failed attempts without lockout", () => {
    for (let i = 1; i <= 5; i++) {
      recordFailedLogin(testEmail);
      const lockout = checkLoginLockout(testEmail);
      expect(lockout.isLocked).toBe(false);
    }
  });

  it("locks out email address after 6 consecutive failed attempts", () => {
    for (let i = 1; i <= 6; i++) {
      recordFailedLogin(testEmail);
    }

    const lockout = checkLoginLockout(testEmail);
    expect(lockout.isLocked).toBe(true);
    expect(lockout.remainingSeconds).toBeGreaterThan(0);
  });

  it("clears failed attempts upon successful login", () => {
    for (let i = 1; i <= 5; i++) {
      recordFailedLogin(testEmail);
    }

    clearFailedLogin(testEmail);

    const lockout = checkLoginLockout(testEmail);
    expect(lockout.isLocked).toBe(false);
  });
});
