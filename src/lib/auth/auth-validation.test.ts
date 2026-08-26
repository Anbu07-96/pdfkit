import { describe, expect, it } from "vitest";
import type { User } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import { authOptions } from "@/lib/auth/config";
import {
  validateAndNormalizeEmail,
  validatePassword,
} from "@/lib/auth/validation";

interface ProviderWithOptions {
  id: string;
  authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  options?: {
    authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  };
}

describe("Phase 49 — Email & Password Hardening & Regression Tests", () => {
  const credentialsProvider = authOptions.providers.find(
    (p) => p.id === "credentials",
  ) as unknown as ProviderWithOptions;

  const authorize =
    credentialsProvider?.options?.authorize || credentialsProvider?.authorize;

  describe("Owner-Reported Case Regression Tests", () => {
    it("REJECTS user@user.com as placeholder/untrusted domain", () => {
      const emailRes = validateAndNormalizeEmail("user@user.com");
      expect(emailRes.isValid).toBe(false);
      expect(emailRes.error).toContain("placeholder email domains are not permitted");
    });

    it("REJECTS 1234asdf as a weak/sequential common password", () => {
      const passRes = validatePassword("1234asdf");
      expect(passRes.isValid).toBe(false);
      expect(passRes.error).toContain("too common");
    });

    it("REJECTS user@user.com + 1234asdf in credentials authorize()", async () => {
      const user = await authorize!({
        email: "user@user.com",
        password: "1234asdf",
      });
      expect(user).toBeNull();
    });
  });

  describe("Email Validation & Normalization", () => {
    it("validates and normalizes legitimate emails to lowercase", () => {
      const res = validateAndNormalizeEmail("  Alice.Smith@Gmail.COM  ");
      expect(res.isValid).toBe(true);
      expect(res.normalizedEmail).toBe("alice.smith@gmail.com");
    });

    it("rejects malformed email formats", () => {
      expect(validateAndNormalizeEmail("abc").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user@").isValid).toBe(false);
      expect(validateAndNormalizeEmail("@gmail.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user..name@gmail.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user@domain..com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user name@gmail.com").isValid).toBe(false);
    });

    it("rejects disposable and placeholder email domains", () => {
      expect(validateAndNormalizeEmail("test@mailinator.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user@tempmail.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("junk@yopmail.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("test@test.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("dummy@dummy.com").isValid).toBe(false);
    });

    it("accepts mainstream email providers and custom domain emails", () => {
      expect(validateAndNormalizeEmail("user@gmail.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@outlook.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@yahoo.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@proton.me").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@icloud.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("owner@company.com").isValid).toBe(true);
    });
  });

  describe("Password Policy Hardening", () => {
    it("rejects passwords shorter than 8 characters", () => {
      expect(validatePassword("Pass1").isValid).toBe(false);
      expect(validatePassword("Short12").isValid).toBe(false);
    });

    it("rejects passwords longer than 128 characters", () => {
      const longPass = "A1" + "a".repeat(130);
      expect(validatePassword(longPass).isValid).toBe(false);
    });

    it("rejects passwords missing numbers or letters", () => {
      expect(validatePassword("onlyletters").isValid).toBe(false);
      expect(validatePassword("123456789").isValid).toBe(false);
    });

    it("rejects passwords containing spaces or control characters", () => {
      expect(validatePassword("Valid Pass123").isValid).toBe(false);
      expect(validatePassword("Pass123\n").isValid).toBe(false);
    });

    it("rejects common easily guessed passwords and sequential patterns", () => {
      expect(validatePassword("password123").isValid).toBe(false);
      expect(validatePassword("12345678").isValid).toBe(false);
      expect(validatePassword("qwerty123").isValid).toBe(false);
      expect(validatePassword("admin123").isValid).toBe(false);
      expect(validatePassword("1234asdf").isValid).toBe(false);
      expect(validatePassword("asdf1234").isValid).toBe(false);
    });

    it("accepts strong alphanumeric passwords", () => {
      expect(validatePassword("SecurePass2026").isValid).toBe(true);
      expect(validatePassword("PdfKitUser99").isValid).toBe(true);
    });
  });

  describe("Credentials Provider Integration", () => {
    it("rejects login with disposable email", async () => {
      expect(
        await authorize!({
          email: "spam@mailinator.com",
          password: "SecurePass2026",
        }),
      ).toBeNull();
    });

    it("rejects login with weak common password", async () => {
      expect(
        await authorize!({
          email: "alice@gmail.com",
          password: "password123",
        }),
      ).toBeNull();
    });

    it("normalizes uppercase email on successful login", async () => {
      const user = await authorize!({
        email: "  Alice.Smith@Gmail.COM  ",
        password: "SecurePass2026",
      });

      expect(user).not.toBeNull();
      expect(user?.email).toBe("alice.smith@gmail.com");
      expect(user?.name).toBe("alice.smith");
      expect((user as User & { tier?: string })?.tier).toBe("free");
    });
  });

  describe("JWT & Session Callbacks", () => {
    it("jwt and session callbacks map user fields correctly", async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      const sessionCallback = authOptions.callbacks?.session;

      const mockToken = await jwtCallback!({
        token: {},
        user: { id: "usr_999", tier: "pro" } as User,
        account: null,
      });

      expect(mockToken.id).toBe("usr_999");
      expect(mockToken.tier).toBe("pro");

      const mockAdapterUser: AdapterUser = {
        id: "usr_999",
        email: "test@gmail.com",
        emailVerified: null,
      };

      const mockSession = await sessionCallback!({
        session: { user: { name: "Test", email: "test@gmail.com", image: null }, expires: "2099-01-01" },
        token: mockToken,
        user: mockAdapterUser,
        newSession: false,
        trigger: "update",
      });

      const userObj = mockSession.user as { id?: string; tier?: string };
      expect(userObj.id).toBe("usr_999");
      expect(userObj.tier).toBe("pro");
    });
  });
});
