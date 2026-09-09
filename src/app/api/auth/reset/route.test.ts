// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ESM module namespaces are frozen — vi.spyOn cannot redefine next-auth's
// getServerSession, so a hoisted module mock with a controllable fn is used.
const getServerSessionMock = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));
import { POST as resetRequestRoute } from "@/app/api/auth/reset-request/route";
import { POST as resetConfirmRoute } from "@/app/api/auth/reset-confirm/route";
import { getUserIdentity } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

/**
 * Phase 66 — password-reset route behavior + session invalidation after reset.
 */

const EMAIL = "route-reset@phase66.test";

// Unique source IP per test: the in-process fallback limiter state persists
// across tests in one file, and requests from earlier tests would consume the
// budget of later ones.
let ipCounter = 100;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function request(path: string, body: unknown, ip = freshIp()): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("Password reset routes (Phase 66)", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(async () => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    await repo.upsertUserAccount({
      userId: "usr_route_reset",
      email: EMAIL,
      tier: "free",
      passwordHash: await hashPassword("OriginalPass2026"),
    });
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reset-request answers 200 with an identical generic body for any address", async () => {
    const known = await resetRequestRoute(request("/api/auth/reset-request", { email: EMAIL }));
    const unknown = await resetRequestRoute(request("/api/auth/reset-request", { email: "who@phase66.test" }));
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);

    const knownBody = (await known.json()) as { message: string };
    const unknownBody = (await unknown.json()) as { message: string };
    expect(knownBody.message).toBe(unknownBody.message);
    expect(knownBody.message).toContain("If an account exists");
    expect(JSON.stringify(knownBody)).not.toContain(EMAIL);
  });

  it("reset-request rate-limits after 10 requests from one client", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await resetRequestRoute(
        request("/api/auth/reset-request", { email: EMAIL }, ip),
      );
      expect(res.status).toBe(200);
    }
    const eleventh = await resetRequestRoute(
      request("/api/auth/reset-request", { email: EMAIL }, ip),
    );
    expect(eleventh.status).toBe(429);
  });

  it("reset-confirm with a valid token updates the password", async () => {
    const req = await resetRequestRoute(request("/api/auth/reset-request", { email: EMAIL }));
    const body = (await req.json()) as { devToken?: string };
    expect(body.devToken).toBeDefined(); // development convenience only

    const confirm = await resetConfirmRoute(
      request("/api/auth/reset-confirm", { token: body.devToken, password: "BrandNew2026pass" }),
    );
    expect(confirm.status).toBe(200);

    const auth = await repo.getUserAccountAuthByEmail(EMAIL);
    expect(auth?.passwordHash).not.toBeNull();
  });

  it("reset-confirm rejects an invalid token with 400", async () => {
    const confirm = await resetConfirmRoute(
      request("/api/auth/reset-confirm", { token: "f".repeat(64), password: "BrandNew2026pass" }),
    );
    expect(confirm.status).toBe(400);
    const body = (await confirm.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("reset-confirm rejects a weak password with 400 and a WEAK_PASSWORD code", async () => {
    const req = await resetRequestRoute(request("/api/auth/reset-request", { email: EMAIL }));
    const body = (await req.json()) as { devToken?: string };
    const confirm = await resetConfirmRoute(
      request("/api/auth/reset-confirm", { token: body.devToken, password: "weak" }),
    );
    expect(confirm.status).toBe(400);
    const parsed = (await confirm.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe("WEAK_PASSWORD");
  });

  it("production without SMTP fails CLOSED with a generic 503 (no enumeration)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SMTP_HOST;
    const res = await resetRequestRoute(request("/api/auth/reset-request", { email: EMAIL }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message?: string; error?: { message: string } };
    const text = JSON.stringify(body);
    expect(text).not.toContain(EMAIL);
  });
});

describe("Session invalidation after password reset (Phase 66)", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
  });

  /** NextAuth session with a given JWT issued-at (unix seconds). */
  function sessionWith(iat: number) {
    getServerSessionMock.mockResolvedValue({
      user: { id: "usr_session_reset", email: EMAIL, name: "R", sessionIssuedAt: iat },
    });
  }

  it("a session issued BEFORE the reset is treated as anonymous", async () => {
    await repo.upsertUserAccount({
      userId: "usr_session_reset",
      email: EMAIL,
      tier: "free",
      passwordResetAt: new Date(Date.now() + 5000), // reset happened "after" the token
    });
    sessionWith(Math.floor((Date.now() - 60_000) / 1000)); // issued a minute ago
    const identity = await getUserIdentity();
    expect(identity.isAuthenticated).toBe(false); // pre-reset session rejected
    expect(identity.userId).toBe("anon");
  });

  it("a session issued AFTER the reset stays valid and reads the DB tier", async () => {
    await repo.upsertUserAccount({
      userId: "usr_session_reset",
      email: EMAIL,
      tier: "pro",
      passwordResetAt: new Date(Date.now() - 60_000), // reset a minute ago
    });
    sessionWith(Math.floor(Date.now() / 1000)); // issued now
    const identity = await getUserIdentity();
    expect(identity.isAuthenticated).toBe(true);
    expect(identity.tier).toBe("pro"); // DB is the source of truth, not the token
  });
});
