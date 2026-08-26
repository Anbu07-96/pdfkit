import { describe, expect, it } from "vitest";
import type { User } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import { authOptions } from "@/lib/auth/config";

interface ProviderWithOptions {
  id: string;
  authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  options?: {
    authorize?: (credentials?: Record<string, string>) => Promise<User | null>;
  };
}

describe("Phase 45 — Authentication Security & Negative Testing", () => {
  const credentialsProvider = authOptions.providers.find(
    (p) => p.id === "credentials",
  ) as unknown as ProviderWithOptions;

  const authorize =
    credentialsProvider?.options?.authorize || credentialsProvider?.authorize;

  it("rejects login when credentials object is undefined or empty", async () => {
    expect(await authorize!(undefined)).toBeNull();
    expect(await authorize!({})).toBeNull();
  });

  it("rejects login when email is missing or empty", async () => {
    expect(await authorize!({ password: "password123" })).toBeNull();
    expect(await authorize!({ email: "", password: "password123" })).toBeNull();
    expect(await authorize!({ email: "   ", password: "password123" })).toBeNull();
  });

  it("rejects login when password is missing or empty", async () => {
    expect(await authorize!({ email: "user@example.com" })).toBeNull();
    expect(await authorize!({ email: "user@example.com", password: "" })).toBeNull();
    expect(await authorize!({ email: "user@example.com", password: "   " })).toBeNull();
  });

  it("rejects login when email format is malformed or invalid", async () => {
    expect(await authorize!({ email: "invalid-email", password: "password123" })).toBeNull();
    expect(await authorize!({ email: "anbu@zz", password: "password123" })).toBeNull();
    expect(await authorize!({ email: "test@domain", password: "password123" })).toBeNull();
    expect(await authorize!({ email: "@domain.com", password: "password123" })).toBeNull();
  });

  it("rejects login when password is shorter than 6 characters", async () => {
    expect(await authorize!({ email: "user@example.com", password: "123" })).toBeNull();
    expect(await authorize!({ email: "user@example.com", password: "12345" })).toBeNull();
  });

  it("accepts login when email format is valid and password length >= 6", async () => {
    const user = await authorize!({
      email: "alice@example.com",
      password: "securepassword123",
    });

    expect(user).not.toBeNull();
    expect(user?.email).toBe("alice@example.com");
    expect(user?.name).toBe("alice");
    expect((user as User & { tier?: string })?.tier).toBe("free");
    expect(user?.id).toMatch(/^usr_/);
  });

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
      email: "test@example.com",
      emailVerified: null,
    };

    const mockSession = await sessionCallback!({
      session: { user: { name: "Test", email: "test@example.com", image: null }, expires: "2099-01-01" },
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
