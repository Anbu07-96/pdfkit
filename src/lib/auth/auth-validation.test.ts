import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import { authOptions, getAuthProviders } from "@/lib/auth/config";
import {
  validateAndNormalizeEmail,
  validatePassword,
} from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

interface ProviderWithOptions {
  id: string;
  authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  options?: {
    authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  };
}

describe("Phase 54 — Auth Hardening, Provider Removal & Anti-Bot Security", () => {
  const credentialsProvider = authOptions.providers.find(
    (p) => p.id === "credentials",
  ) as unknown as ProviderWithOptions;

  const authorize =
    credentialsProvider?.options?.authorize || credentialsProvider?.authorize;

  describe("Provider Configuration", () => {
    it("does NOT include GitHub provider", () => {
      const providers = getAuthProviders();
      const githubProvider = providers.find((p) => p.id === "github");
      expect(githubProvider).toBeUndefined();
    });

    it("includes Google and Azure AD / Microsoft providers when env vars exist", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google_id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google_secret");
      vi.stubEnv("MICROSOFT_CLIENT_ID", "ms_id");
      vi.stubEnv("MICROSOFT_CLIENT_SECRET", "ms_secret");

      const providers = getAuthProviders();
      const googleProvider = providers.find((p) => p.id === "google");
      const azureProvider = providers.find((p) => p.id === "azure-ad");

      expect(googleProvider).toBeDefined();
      expect(azureProvider).toBeDefined();

      vi.unstubAllEnvs();
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
      expect(validateAndNormalizeEmail("user@user.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("test@test.com").isValid).toBe(false);
    });

    it("accepts mainstream email providers and custom domain emails", () => {
      expect(validateAndNormalizeEmail("user@gmail.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@outlook.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@yahoo.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@proton.me").isValid).toBe(true);
      expect(validateAndNormalizeEmail("user@icloud.com").isValid).toBe(true);
      expect(validateAndNormalizeEmail("alice@company.com").isValid).toBe(true);
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
    });

    it("rejects passwords containing the user's email local-part", () => {
      expect(validatePassword("johnsmith123", "johnsmith@gmail.com").isValid).toBe(false);
      expect(validatePassword("alice2026pass", "alice@gmail.com").isValid).toBe(false);
    });

    it("accepts strong alphanumeric passwords", () => {
      expect(validatePassword("SecurePass2026", "john@gmail.com").isValid).toBe(true);
      expect(validatePassword("PdfKitUser99", "bob@gmail.com").isValid).toBe(true);
    });
  });

  describe("Credentials Provider Integration (Phase 65: real password verification)", () => {
    let repo: InMemoryUsageRepository;

    beforeEach(async () => {
      repo = new InMemoryUsageRepository();
      setUsageRepositoryOverride(repo);
      await repo.upsertUserAccount({
        userId: "usr_realuser1",
        email: "alice.smith@gmail.com",
        name: "alice.smith",
        tier: "free",
        status: "active",
        passwordHash: await hashPassword("SecurePass2026"),
      });
    });

    afterEach(() => {
      setUsageRepositoryOverride(null);
      vi.unstubAllEnvs();
    });

    it("rejects login with disposable email", async () => {
      expect(
        await authorize!({
          email: "spam@mailinator.com",
          password: "SecurePass2026",
        }),
      ).toBeNull();
    });

    it("rejects login when no account exists for the email", async () => {
      expect(
        await authorize!({
          email: "nobody@gmail.com",
          password: "SecurePass2026",
        }),
      ).toBeNull();
    });

    it("rejects the CORRECT-format but WRONG password (stored hash is the truth)", async () => {
      expect(
        await authorize!({
          email: "alice.smith@gmail.com",
          password: "AlsoSecure2027",
        }),
      ).toBeNull();
    });

    it("rejects a suspended account even with the right password", async () => {
      await repo.upsertUserAccount({
        userId: "usr_suspended1",
        email: "bob@gmail.com",
        tier: "free",
        status: "suspended",
        passwordHash: await hashPassword("SecurePass2026"),
      });
      expect(
        await authorize!({
          email: "bob@gmail.com",
          password: "SecurePass2026",
        }),
      ).toBeNull();
    });

    it("normalizes uppercase email on successful login and returns the stored tier", async () => {
      await repo.upsertUserAccount({
        userId: "usr_proeditor",
        email: "carol@gmail.com",
        tier: "pro",
        status: "active",
        passwordHash: await hashPassword("SecurePass2026"),
      });

      const user = await authorize!({
        email: "  Carol@Gmail.COM  ",
        password: "SecurePass2026",
      });

      expect(user).not.toBeNull();
      expect(user?.id).toBe("usr_proeditor");
      expect(user?.email).toBe("carol@gmail.com");
      expect(user?.name).toBe("carol");
      expect((user as User & { tier?: string })?.tier).toBe("pro");
    });

    it("locks the account after repeated wrong passwords (existing tracker now guards real failures)", async () => {
      for (let i = 0; i < 6; i++) {
        expect(
          await authorize!({
            email: "alice.smith@gmail.com",
            password: "WrongPassword2026",
          }),
        ).toBeNull();
      }
      // Locked now — even the CORRECT password is rejected.
      expect(
        await authorize!({
          email: "alice.smith@gmail.com",
          password: "SecurePass2026",
        }),
      ).toBeNull();
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
