import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANONYMOUS_USER_IDENTITY, getUserIdentity } from "@/lib/auth/session";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth";

const mockedGetServerSession = vi.mocked(getServerSession);

describe("getUserIdentity", () => {
  beforeEach(() => {
    mockedGetServerSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ANONYMOUS_USER_IDENTITY when no session exists", async () => {
    mockedGetServerSession.mockResolvedValueOnce(null);
    const identity = await getUserIdentity();

    expect(identity).toEqual(ANONYMOUS_USER_IDENTITY);
    expect(identity.isAuthenticated).toBe(false);
    expect(identity.userId).toBe("anon");
    expect(identity.tier).toBe("anonymous");
  });

  it("returns authenticated UserIdentity when session exists", async () => {
    mockedGetServerSession.mockResolvedValueOnce({
      user: {
        id: "usr_123",
        email: "alice@example.com",
        name: "Alice",
        tier: "free",
      },
      expires: "2099-01-01",
    });

    const identity = await getUserIdentity();

    expect(identity.isAuthenticated).toBe(true);
    expect(identity.userId).toBe("usr_123");
    expect(identity.email).toBe("alice@example.com");
    expect(identity.name).toBe("Alice");
    expect(identity.status).toBe("active");
    expect(identity.tier).toBe("free");
  });

  it("falls back safely to ANONYMOUS_USER_IDENTITY if getServerSession throws", async () => {
    mockedGetServerSession.mockRejectedValueOnce(new Error("Auth session error"));
    const identity = await getUserIdentity();

    expect(identity).toEqual(ANONYMOUS_USER_IDENTITY);
    expect(identity.isAuthenticated).toBe(false);
  });
});
