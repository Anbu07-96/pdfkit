// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/register/route";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

/**
 * Phase 65 — real account registration.
 *
 * Registration previously called signIn() directly: no account record, no
 * password stored, and authorize() accepted any policy-valid pair. The route
 * now creates the account (scrypt hash + verification token) and signIn
 * verifies against it.
 */

function registerRequest(email: string, password: string, ip = "198.51.100.10"): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /api/auth/register", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates an account with a hashed password and verification token", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await POST(registerRequest("new.user@gmail.com", "SecurePass2026"));
    expect(res.status).toBe(201);

    const auth = await repo.getUserAccountAuthByEmail("new.user@gmail.com");
    expect(auth).not.toBeNull();
    expect(auth!.passwordHash?.startsWith("scrypt:")).toBe(true);
    expect(auth!.passwordHash).not.toContain("SecurePass2026");
    expect(auth!.tier).toBe("free");
    expect(auth!.status).toBe("active");

    const account = await repo.getUserAccount(auth!.userId);
    expect(account?.verificationToken).toBeTruthy();
    expect(account?.verificationExpires).toBeTruthy();
    expect(account?.authProvider).toBe("credentials");
  });

  it("rejects disposable domains", async () => {
    const res = await POST(registerRequest("spam@mailinator.com", "SecurePass2026"));
    expect(res.status).toBe(400);
    expect(await repo.getUserAccountAuthByEmail("spam@mailinator.com")).toBeNull();
  });

  it("rejects weak passwords (policy enforced at registration)", async () => {
    const res = await POST(registerRequest("weak@gmail.com", "password123"));
    expect(res.status).toBe(400);
    expect(await repo.getUserAccountAuthByEmail("weak@gmail.com")).toBeNull();
  });

  it("rejects malformed bodies", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 for an already-registered email (no duplicate accounts)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const first = await POST(registerRequest("dup@gmail.com", "SecurePass2026"));
    expect(first.status).toBe(201);

    const second = await POST(registerRequest("DUP@Gmail.com", "OtherPass2026"));
    expect(second.status).toBe(409);

    // Still exactly one account for that email, original hash intact.
    const auth = await repo.getUserAccountAuthByEmail("dup@gmail.com");
    expect(auth).not.toBeNull();
    expect(await import("@/lib/auth/password").then((m) => m.verifyPassword("SecurePass2026", auth!.passwordHash))).toBe(true);
  });

  it("rate-limits registration under its own scope (10/min per IP)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const ip = "198.51.100.12";
    let lastStatus = 201;
    for (let i = 0; i < 12; i++) {
      const res = await POST(registerRequest(`rl${i}@gmail.com`, "SecurePass2026", ip));
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("never echoes the password in any response", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await POST(registerRequest("echo@gmail.com", "NeverEchoThis2026"));
    const text = JSON.stringify(await res.json());
    expect(text.includes("NeverEchoThis2026")).toBe(false);
  });
});
