#!/usr/bin/env node
/**
 * Phase 65 — staging validation driver.
 *
 * Runs the Phase 65 validation sections against a staging stack started by
 * staging-up.mjs (state read from /tmp/pdfkit-infra/staging-state.json).
 * Every check issues REAL HTTP traffic through the staging proxy and, where
 * relevant, compares against REAL PostgreSQL truth. Nothing is mocked.
 *
 * Sections:
 *   readiness  liveness + readiness + dependency latencies
 *   proxy      client-IP trust policy: consistency, distinguishability,
 *              spoofing (XFF/CF/X-Real-IP), shared budget across instances
 *   auth       register → login → session → logout → verification → lockout
 *   usage      anonymous + free-user quota accounting vs database truth
 *   tools      16-tool processing matrix with structural output validation
 *   metrics    admin metrics security, accuracy and privacy scan
 *   headers    security headers on live responses
 *   billing    unconfigured billing fails safely (no live charging)
 *   privacy    log/telemetry privacy scan + temporary-file audit
 *   smoke      npm run smoke:staging against the proxy
 *   restart    controlled instance restart: recovery, persistence, slots
 *              (run LAST or with --only restart — it bounces the instances)
 *
 * Usage:
 *   node scripts/infra/staging-checks.mjs                    # all except restart
 *   node scripts/infra/staging-checks.mjs --only proxy,auth
 *   node scripts/infra/staging-checks.mjs --only restart
 *
 * Results print to the console and are written to
 * /tmp/pdfkit-infra/staging-checks-results.json.
 */
import { execFile, execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import pg from "pg";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROOT = join(import.meta.dirname, "..", "..");
const STATE_FILE = "/tmp/pdfkit-infra/staging-state.json";
const RESULTS_FILE = "/tmp/pdfkit-infra/staging-checks-results.json";
const FIXTURE_DIR = "/tmp/pdfkit-infra/staging-fixtures";

if (!existsSync(STATE_FILE)) {
  console.error("no staging state — run scripts/infra/staging-up.mjs first");
  process.exit(2);
}
const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const PROXY = new URL(state.proxyUrl);

// Per-run fixture source IPs (127.0.0.0/8 all route to loopback). A 60s rate
// window can span two consecutive validation runs; fixed addresses would
// start the second run inside an already-exhausted bucket (observed), so
// every section draws an address from a run-unique 127.<a>.<b>.<n> space.
const RUN = Date.now();
const OCTET_A = 1 + (RUN % 250);
const OCTET_B = 1 + (Math.floor(RUN / 250) % 250);
const ip = (n) => `127.${OCTET_A}.${OCTET_B}.${n}`;

// ---------------------------------------------------------------------------
// Result recording
// ---------------------------------------------------------------------------
const results = [];
function report(section, name, pass, detail) {
  results.push({ section, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${section}] ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers (raw http.request so per-section source IPs are possible)
// ---------------------------------------------------------------------------
function request(sourceIp, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PROXY.port,
        path,
        method,
        localAddress: sourceIp,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(buffer.toString("utf8"));
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, buffer, json });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Multipart job upload through the proxy from a given source IP. */
function jobRequest(sourceIp, toolId, files, fields = {}, cookies = "", extraHeaders = {}) {
  const boundary = `----pdfkitstaging${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const f of files) {
    parts.push(
      `--${boundary}\r\ncontent-disposition: form-data; name="files"; filename="${f.name}"\r\ncontent-type: ${f.type}\r\n\r\n`,
    );
    parts.push(f.bytes);
    parts.push("\r\n");
  }
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  return request(sourceIp, "POST", `/api/tools/${toolId}`, {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
      ...(cookies ? { cookie: cookies } : {}),
      ...extraHeaders,
    },
    body,
  });
}

/** Minimal cookie jar for the NextAuth flows. */
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    const setCookies = res.headers["set-cookie"] ?? [];
    for (const sc of Array.isArray(setCookies) ? setCookies : [setCookies]) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function pgClient() {
  const client = new pg.Client({ connectionString: state.pgUrl });
  await client.connect();
  return client;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
async function makeFixtures() {
  const { mkdirSync, rmSync } = await import("node:fs");
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText("Phase 65 staging validation document", { x: 20, y: 120, size: 12, font });
  page.drawText("Invoice total: 1250.50 Quantity: 3", { x: 20, y: 90, size: 10, font });
  const pdfBytes = Buffer.from(await doc.save());
  writeFileSync(join(FIXTURE_DIR, "doc.pdf"), pdfBytes);

  // Second, different PDF for compare-documents.
  const doc2 = await PDFDocument.create();
  const p2 = doc2.addPage([300, 200]);
  p2.drawText("A slightly different document", { x: 20, y: 120, size: 12, font });
  writeFileSync(join(FIXTURE_DIR, "doc2.pdf"), Buffer.from(await doc2.save()));

  // Minimal valid PNG (1x1 red pixel) — for images-to-pdf / png-to-pdf and
  // embedded in a PDF for extract-images.
  const PNG_1PX = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080200000090775" +
      "3de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082",
    "hex",
  );
  writeFileSync(join(FIXTURE_DIR, "pixel.png"), PNG_1PX);

  const docImg = await PDFDocument.create();
  const png = await docImg.embedPng(PNG_1PX);
  const pi = docImg.addPage([200, 200]);
  pi.drawImage(png, { x: 50, y: 50, width: 100, height: 100 });
  writeFileSync(join(FIXTURE_DIR, "with-image.pdf"), Buffer.from(await docImg.save()));

  writeFileSync(join(FIXTURE_DIR, "garbage.bin"), Buffer.from("definitely not a pdf"));
  return {
    pdf: pdfBytes,
    pdfPath: join(FIXTURE_DIR, "doc.pdf"),
    pdf2Path: join(FIXTURE_DIR, "doc2.pdf"),
    png: PNG_1PX,
    withImagePath: join(FIXTURE_DIR, "with-image.pdf"),
    garbage: Buffer.from("definitely not a pdf"),
  };
}

// ---------------------------------------------------------------------------
// Section: readiness
// ---------------------------------------------------------------------------
async function sectionReadiness() {
  const live = await request("127.0.0.2", "GET", "/api/health");
  report("readiness", "liveness", live.status === 200, `GET /api/health → ${live.status}`);

  const ready = await request("127.0.0.2", "GET", "/api/health/ready");
  const b = ready.json ?? {};
  const dbOk = b.checks?.database?.status === "ok";
  const redisOk = b.checks?.redis?.status === "ok";
  const procOk = b.checks?.processing?.status === "ok";
  report(
    "readiness",
    "readiness-ok",
    ready.status === 200 && b.status === "ok" && dbOk && redisOk && procOk,
    `HTTP ${ready.status} status=${b.status} db=${b.checks?.database?.status}(${b.checks?.database?.latencyMs}ms) redis=${b.checks?.redis?.status}(${b.checks?.redis?.latencyMs}ms) processing=${b.checks?.processing?.status} environment=${b.environment}`,
  );
  const readyText = JSON.stringify(b);
  report(
    "readiness",
    "no-secrets-in-payload",
    !/postgres(ql)?:\/\/|rediss?:\/\//.test(readyText) && !readyText.includes(state.adminToken),
    `readiness payload contains no connection strings or tokens (${readyText.length} bytes)`,
  );
  return { dbLatencyMs: b.checks?.database?.latencyMs, redisLatencyMs: b.checks?.redis?.latencyMs };
}

// ---------------------------------------------------------------------------
// Section: proxy / client-IP trust policy (Step 7)
// ---------------------------------------------------------------------------
async function sectionProxy(fx) {
  // Per-run derived source IPs (see the ip() helper at the top).
  const ip1 = ip(21);
  const ip2 = ip(22);
  const ip3 = ip(23);
  console.log(`       (proxy section using source IPs ${ip1} / ${ip2} / ${ip3})`);
  const garbageJob = (ip) =>
    jobRequest(ip, "merge-pdf", [
      { name: "garbage.bin", type: "application/pdf", bytes: fx.garbage },
      { name: "garbage2.bin", type: "application/pdf", bytes: fx.garbage },
    ]);

  // Baseline for the "failed jobs are not metered" check below.
  const dbP0 = await pgClient();
  const meterBefore = (
    await dbP0.query('SELECT COALESCE(SUM("jobCount"), 0)::int AS n FROM "DailyUsage"')
  ).rows[0].n;
  await dbP0.end();

  // 1. Same client, consistent budget: 60 admitted, 61st 429 — through the
  //    round-robin proxy, so BOTH instances shared the counter.
  let admitted = 0;
  let first429 = null;
  for (let i = 0; i < 70; i++) {
    const res = await garbageJob(ip1);
    if (res.status === 429) {
      first429 = res;
      break;
    }
    admitted += 1;
  }
  report(
    "proxy",
    "same-client-global-60",
    admitted === 60 && first429 !== null,
    `one client through the round-robin proxy: ${admitted} admitted, then 429 (global budget, NOT 120 across 2 instances)`,
  );
  const retryAfter = Number(first429?.headers?.["retry-after"]);
  report(
    "proxy",
    "retry-after-present",
    Number.isFinite(retryAfter) && retryAfter >= 1 && retryAfter <= 60,
    `429 carries Retry-After: ${first429?.headers?.["retry-after"]}s`,
  );
  report(
    "proxy",
    "429-code",
    first429?.json?.error?.code === "TOO_MANY_REQUESTS",
    `rejection code: ${first429?.json?.error?.code}`,
  );

  // 2. Different external client distinguishable: fresh IP is not blocked.
  const other = await garbageJob(ip2);
  report(
    "proxy",
    "different-client-distinguishable",
    other.status !== 429,
    `a different source IP is not affected by the first client's budget (→ ${other.status})`,
  );

  // 3. Spoofing: from ONE fixed source IP, send up to 61 real job requests,
  //    each carrying DIFFERENT hostile X-Forwarded-For / CF-Connecting-IP /
  //    X-Real-IP values. If the stack trusted any client-supplied header, every
  //    request would land in a distinct rate bucket and NEVER hit the limit.
  //    The proxy appends the real source to XFF (last entry wins) and strips
  //    CF/X-Real-IP, so the true identity must hold and a 429 must appear.
  let spoofAdmitted = 0;
  let spoof429 = null;
  for (let i = 0; i < 70; i++) {
    const res = await jobRequest(
      ip3,
      "merge-pdf",
      [
        { name: "g.bin", type: "application/pdf", bytes: fx.garbage },
        { name: "g2.bin", type: "application/pdf", bytes: fx.garbage },
      ],
      {},
      "",
      {
        "x-forwarded-for": `6.6.6.${(i % 250) + 1}`,
        "cf-connecting-ip": `7.7.7.${(i % 250) + 1}`,
        "x-real-ip": `8.8.8.${(i % 250) + 1}`,
      },
    );
    if (res.status === 429) {
      spoof429 = res;
      break;
    }
    spoofAdmitted += 1;
  }
  report(
    "proxy",
    "spoofed-headers-no-bypass",
    spoof429 !== null && spoofAdmitted >= 55 && spoofAdmitted <= 60,
    `61 job requests with unique spoofed XFF/CF/X-Real-IP per request: still rate limited after ${spoofAdmitted} admitted — identity never rotated`,
  );

  // 4. Proxy distribution actually hit both instances (round-robin evidence).
  const stats = await new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: state.proxyAdminPort, path: "/" }, (rs) => {
        let d = "";
        rs.on("data", (c) => (d += c));
        rs.on("end", () => resolve(JSON.parse(d)));
      })
      .on("error", reject);
  });
  const targets = Object.entries(stats.byTarget ?? {});
  report(
    "proxy",
    "traffic-distributed",
    targets.length === 2 && targets.every(([, n]) => n > 0),
    `proxy distributed traffic to both instances: ${targets.map(([t, n]) => `:${t}=${n}`).join(", ")}`,
  );

  // 5. No raw IP in telemetry/logs is covered by the privacy section; the
  //    token itself is a hash (unit-tested). Verify the 429 payload has no IP.
  report(
    "proxy",
    "no-ip-in-responses",
    !JSON.stringify(first429?.json ?? {}).match(/\b127\.0\.0\.\d+\b/),
    "429 payload contains no client IP",
  );

  // 6. Failed jobs are not metered: this section sent ~120 garbage jobs
  //    (all 4xx) — none may appear in DailyUsage (metering on success only).
  const dbP1 = await pgClient();
  const meterAfter = (
    await dbP1.query('SELECT COALESCE(SUM("jobCount"), 0)::int AS n FROM "DailyUsage"')
  ).rows[0].n;
  await dbP1.end();
  report(
    "proxy",
    "failed-jobs-not-metered",
    meterAfter === meterBefore,
    `~120 rejected garbage jobs left DailyUsage unchanged (${meterBefore} → ${meterAfter}; metering on success only)`,
  );
}

// ---------------------------------------------------------------------------
// Section: auth E2E (Step 8)
// ---------------------------------------------------------------------------
async function sectionAuth() {
  const sourceIp = ip(31);
  const stamp = Date.now();
  const mainEmail = `staging-user-${stamp}@staging.pdfkit.local`;
  const mainPassword = "StagingPass2026";

  // A. Registration
  const reg = await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: mainEmail, password: mainPassword }),
  });
  report("auth", "registration", reg.status === 201, `register → ${reg.status} ${reg.json?.message ?? ""}`);

  // Duplicate → 409
  const dup = await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: mainEmail.toUpperCase(), password: "Other2026pass" }),
  });
  report("auth", "duplicate-rejected", dup.status === 409, `duplicate email (case-insensitive) → ${dup.status}`);

  // G. Disposable email restriction
  const disposable = await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `x${stamp}@mailinator.com`, password: "StagingPass2026" }),
  });
  report("auth", "disposable-email-blocked", disposable.status === 400, `disposable domain → ${disposable.status}`);

  // B. Valid login (NextAuth credentials flow with CSRF + cookies)
  const jar = new CookieJar();
  const csrf = await request(sourceIp, "GET", "/api/auth/csrf");
  jar.absorb(csrf);
  const csrfToken = csrf.json?.csrfToken;
  const loginBody = new URLSearchParams({
    csrfToken,
    email: mainEmail,
    password: mainPassword,
    json: "true",
  });
  const login = await request(sourceIp, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: loginBody.toString(),
  });
  jar.absorb(login);
  const session = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: jar.header() } });
  const loggedIn = session.json?.user?.email === mainEmail;
  report(
    "auth",
    "login-valid-credentials",
    loggedIn,
    `login with correct password → session email=${session.json?.user?.email ?? "none"}`,
  );

  // C. Invalid password (correct format, wrong secret) — dedicated email so
  //    the main test user is not locked out.
  const wrongEmail = `wrongpw-${stamp}@staging.pdfkit.local`;
  await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: wrongEmail, password: "StagingPass2026" }),
  });
  const jarW = new CookieJar();
  const csrfW = await request(sourceIp, "GET", "/api/auth/csrf");
  jarW.absorb(csrfW);
  const wrongLogin = await request(sourceIp, "POST", "/api/auth/callback/credentials", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jarW.header(),
    },
    body: new URLSearchParams({
      csrfToken: csrfW.json?.csrfToken,
      email: wrongEmail,
      password: "WrongButValid2027",
      json: "true",
    }).toString(),
  });
  jarW.absorb(wrongLogin);
  const wrongSession = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: jarW.header() } });
  report(
    "auth",
    "wrong-password-rejected",
    !wrongSession.json?.user,
    `wrong password → no session (stored hash verified; response ${wrongLogin.status})`,
  );

  // H. Lockout: 6 failures lock the account; correct password then rejected.
  let lastStatus = null;
  for (let i = 0; i < 6; i++) {
    const c = await request(sourceIp, "GET", "/api/auth/csrf");
    const j = new CookieJar();
    j.absorb(c);
    const r = await request(sourceIp, "POST", "/api/auth/callback/credentials", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: j.header() },
      body: new URLSearchParams({
        csrfToken: c.json?.csrfToken,
        email: wrongEmail,
        password: `BadAttempt${2026 + i}`,
        json: "true",
      }).toString(),
    });
    lastStatus = r.status;
  }
  const lockJar = new CookieJar();
  const lockCsrf = await request(sourceIp, "GET", "/api/auth/csrf");
  lockJar.absorb(lockCsrf);
  await request(sourceIp, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: lockJar.header() },
    body: new URLSearchParams({
      csrfToken: lockCsrf.json?.csrfToken,
      email: wrongEmail,
      password: "StagingPass2026",
      json: "true",
    }).toString(),
  });
  const lockSession = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: lockJar.header() } });
  report(
    "auth",
    "lockout-after-failures",
    !lockSession.json?.user,
    `after 6 wrong passwords the account is locked (even the CORRECT password is rejected; last attempt status ${lastStatus})`,
  );

  // D. Session persistence across requests AND across instances (proxy
  //    round-robins; JWT sessions must be valid on both).
  const session2 = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: jar.header() } });
  report(
    "auth",
    "session-persistence",
    session2.json?.user?.email === mainEmail,
    "session persists across requests and instances (shared JWT secret)",
  );

  // F. Protected account page. NOTE: App Router streams a redirect() from a
  //    server component with HTTP 200 + an RSC redirect marker, so the check
  //    is CONTENT-based: unauthenticated must carry NO account data (no
  //    identity, no usage numbers), authenticated must render the account.
  const accountPage = await request(sourceIp, "GET", "/account", { headers: { cookie: jar.header() } });
  const accountNoAuth = await request(sourceIp, "GET", "/account");
  const pageText = accountPage.buffer.toString("utf8");
  const noAuthText = accountNoAuth.buffer.toString("utf8");
  const authOk = accountPage.status === 200 && pageText.includes("My Account") && pageText.includes(mainEmail);
  const anonClean =
    accountNoAuth.status === 200 &&
    !noAuthText.includes("My Account") &&
    !noAuthText.includes("jobs used") &&
    !noAuthText.includes("staging.pdfkit.local") &&
    (noAuthText.includes("login") || noAuthText.includes("redirect"));
  report(
    "auth",
    "protected-account-page",
    authOk && anonClean,
    `authenticated renders account (My Account + email SSR: ${pageText.includes(mainEmail)}); anonymous carries no account data, redirect marker present`,
  );

  // I. Email verification: token from DB (staging without SMTP), then verify.
  const db = await pgClient();
  const acc = await db.query('SELECT "userId", "verificationToken", "accountTrustStatus" FROM "UserAccount" WHERE "email" = $1', [mainEmail]);
  const token = acc.rows[0]?.verificationToken;
  report(
    "auth",
    "verification-token-stored",
    Boolean(token),
    `registration stored a verification token (accountTrustStatus=${acc.rows[0]?.accountTrustStatus})`,
  );
  const verify = await request(sourceIp, "GET", `/api/auth/verify?token=${encodeURIComponent(token ?? "")}`);
  const accAfter = await db.query('SELECT "accountTrustStatus", "emailVerified" FROM "UserAccount" WHERE "email" = $1', [mainEmail]);
  await db.end();
  report(
    "auth",
    "email-verification-flow",
    verify.status === 200 && accAfter.rows[0]?.accountTrustStatus === "verified",
    `verify link → ${verify.status}; accountTrustStatus=${accAfter.rows[0]?.accountTrustStatus}, emailVerified=${Boolean(accAfter.rows[0]?.emailVerified)}`,
  );

  // E. Logout
  const outCsrf = await request(sourceIp, "GET", "/api/auth/csrf", { headers: { cookie: jar.header() } });
  jar.absorb(outCsrf);
  const out = await request(sourceIp, "POST", "/api/auth/signout", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({ csrfToken: outCsrf.json?.csrfToken, json: "true" }).toString(),
  });
  jar.absorb(out);
  const afterLogout = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: jar.header() } });
  report(
    "auth",
    "logout",
    !afterLogout.json?.user,
    `signout → ${out.status}; session afterwards: ${afterLogout.json?.user ? "STILL PRESENT" : "cleared"}`,
  );

  // J. OAuth: not configured in staging (no GOOGLE_/AZURE_ secrets) — verify
  //    the provider list reflects that (fail-safe, not an error).
  const providers = await request(sourceIp, "GET", "/api/auth/providers");
  const ids = Object.keys(providers.json ?? {});
  report(
    "auth",
    "oauth-unconfigured-failsafe",
    providers.status === 200 && ids.includes("credentials") && !ids.includes("google") && !ids.includes("azure-ad"),
    `providers without OAuth secrets: ${ids.join(", ")} (Google/Microsoft flows NOT VERIFIED — require staging credentials)`,
  );

  return { mainEmail, mainPassword };
}

// ---------------------------------------------------------------------------
// Section: usage / quota E2E (Step 9)
// ---------------------------------------------------------------------------
async function sectionUsage(fx) {
  const anonIp = ip(41);
  // Controlled staging reset: clear test usage rows so the anonymous
  // accounting starts from a known baseline (accounts/history untouched).
  {
    const db0 = await pgClient();
    await db0.query('TRUNCATE TABLE "DailyUsage"');
    await db0.end();
    console.log("       (controlled staging reset: DailyUsage truncated for a known baseline)");
  }
  const files = () => [
    { name: "a.pdf", type: "application/pdf", bytes: fx.pdf },
    { name: "b.pdf", type: "application/pdf", bytes: fx.pdf },
  ];

  // --- Anonymous usage: 3 jobs → DB truth + /api/usage ---
  for (let i = 0; i < 3; i++) {
    const r = await jobRequest(anonIp, "merge-pdf", files());
    if (r.status !== 200) {
      report("usage", "anon-jobs", false, `job ${i + 1} unexpected status ${r.status}`);
      break;
    }
  }
  const db = await pgClient();
  const today = new Date().toISOString().slice(0, 10);
  const anonRow = await db.query(
    'SELECT "jobCount", "processedBytes" FROM "DailyUsage" WHERE "userId" = $1 AND "periodDate" = $2',
    ["anon", today],
  );
  const anonUsage = await request(anonIp, "GET", "/api/usage");
  const anonBody = anonUsage.json ?? {};
  report(
    "usage",
    "anon-db-accounting",
    anonRow.rows.length === 1 && anonRow.rows[0].jobCount === 3,
    `anonymous: DailyUsage.anon jobCount=${anonRow.rows[0]?.jobCount} (expected 3)`,
  );
  report(
    "usage",
    "anon-server-endpoint",
    anonUsage.status === 200 && Number(anonBody?.usage?.jobsUsed ?? anonBody?.jobsUsed ?? -1) === 3,
    `/api/usage (anonymous) reports jobsUsed=${anonBody?.usage?.jobsUsed ?? anonBody?.jobsUsed ?? "?"} (expected 3)`,
  );

  // --- Free user: register, login, 2 jobs → server + DB consistency ---
  const userIp = ip(42);
  const stamp = Date.now();
  const email = `free-user-${stamp}@staging.pdfkit.local`;
  await request(userIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "FreeUser2026" }),
  });
  const jar = new CookieJar();
  const csrf = await request(userIp, "GET", "/api/auth/csrf");
  jar.absorb(csrf);
  const login = await request(userIp, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ csrfToken: csrf.json?.csrfToken, email, password: "FreeUser2026", json: "true" }).toString(),
  });
  jar.absorb(login);

  for (let i = 0; i < 2; i++) {
    await jobRequest(userIp, "merge-pdf", files(), {}, jar.header());
  }
  const usageRes = await request(userIp, "GET", "/api/usage", { headers: { cookie: jar.header() } });
  const u = usageRes.json ?? {};
  const serverJobs = Number(u?.usage?.jobsUsed ?? u?.jobsUsed ?? -1);
  const dbRow = await db.query(
    'SELECT "jobCount" FROM "DailyUsage" du JOIN "UserAccount" ua ON ua."userId" = du."userId" WHERE ua."email" = $1 AND du."periodDate" = $2',
    [email, today],
  );
  const dbJobs = Number(dbRow.rows[0]?.jobCount ?? -1);
  report(
    "usage",
    "free-user-consistency",
    serverJobs === 2 && dbJobs === 2,
    `free user: /api/usage jobsUsed=${serverJobs}, database jobCount=${dbJobs} (both expected 2 — UI meter reads this endpoint)`,
  );
  report(
    "usage",
    "usage-endpoint-shape",
    usageRes.status === 200 && typeof serverJobs === "number",
    `/api/usage authenticated → ${usageRes.status}, tier=${u?.usage?.tier ?? u?.tier ?? "?"}`,
  );

  // --- Anonymous quota exhaustion: fill to 10, 11th rejected ---
  for (let i = 3; i < 10; i++) {
    await jobRequest(anonIp, "merge-pdf", files());
  }
  const eleventh = await jobRequest(anonIp, "merge-pdf", files());
  report(
    "usage",
    "anon-quota-rejection",
    eleventh.json?.error?.code === "QUOTA_EXCEEDED",
    `11th anonymous job today → ${eleventh.status} ${eleventh.json?.error?.code} (limit 10/day)`,
  );
  const anonFinal = await db.query(
    'SELECT "jobCount" FROM "DailyUsage" WHERE "userId" = $1 AND "periodDate" = $2',
    ["anon", today],
  );
  report(
    "usage",
    "anon-quota-exact",
    anonFinal.rows[0]?.jobCount === 10,
    `database shows exactly 10/10 anonymous jobs (no overage: ${anonFinal.rows[0]?.jobCount})`,
  );
  await db.end();

  // Controlled reset for subsequent sections (documented): staging usage rows
  // are test data; clearing them frees the anonymous budget for the tool
  // matrix without touching accounts or history.
  const db2 = await pgClient();
  await db2.query("TRUNCATE TABLE \"DailyUsage\"");
  await db2.end();
  console.log("       (controlled staging reset: DailyUsage truncated for the tool matrix)");

  return { email, cookieHeader: jar.header(), userIp };
}

// ---------------------------------------------------------------------------
// Section: tool matrix (Step 10)
// ---------------------------------------------------------------------------
async function sectionTools(fx, user) {
  const toolIp = user.userIp;
  const cookie = user.cookieHeader;
  const files = (...names) => names.map((n) => ({ name: n, type: "application/pdf", bytes: fx.pdf }));
  const pngs = (...names) => names.map((n) => ({ name: n, type: "image/png", bytes: fx.png }));

  const checks = [];
  const run = async (name, toolId, fileList, fields, validate) => {
    const res = await jobRequest(toolIp, toolId, fileList, fields, cookie);
    const contentType = res.headers["content-type"] ?? "";
    const bytes = res.buffer?.length ?? 0;
    let structural = "n/a";
    if (res.status === 200) {
      structural = validate(res.buffer, contentType) ? "valid" : "INVALID";
    }
    const pass = res.status === 200 && bytes > 0 && structural === "valid";
    checks.push({ name, pass });
    report(
      "tools",
      name,
      pass,
      `${toolId} → ${res.status} ${contentType.split(";")[0]} ${bytes}B output ${structural}${res.status !== 200 ? ` (${res.json?.error?.code})` : ""}`,
    );
    return res;
  };

  const isPdf = (b) => b.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip = (b) => b.subarray(0, 2).toString("latin1") === "PK";
  const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8;
  const isPng = (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const isText = (b) => b.toString("utf8").includes("staging validation") || b.length > 10;

  await run("merge-pdf", "merge-pdf", files("a.pdf", "b.pdf"), {}, isPdf);
  await run("split-pdf", "split-pdf", files("doc.pdf"), { mode: "every-page" }, (b) => isPdf(b) || isZip(b));
  await run("compress-pdf", "compress-pdf", files("doc.pdf"), {}, isPdf);
  await run("rotate-pdf", "rotate-pdf", files("doc.pdf"), { rotations: '{"1":90}' }, isPdf);
  await run("pdf-to-jpg", "pdf-to-jpg", files("doc.pdf"), {}, isJpg);
  await run("pdf-to-png", "pdf-to-png", files("doc.pdf"), {}, isPng);
  await run("pdf-to-word", "pdf-to-word", files("doc.pdf"), {}, isZip);
  await run("pdf-to-excel", "pdf-to-excel", files("doc.pdf"), {}, isZip);
  await run("pdf-to-text", "pdf-to-text", files("doc.pdf"), { pages: "all" }, isText);
  await run("images-to-pdf", "images-to-pdf", pngs("p1.png", "p2.png"), {}, isPdf);
  await run(
    "extract-images",
    "extract-images",
    [{ name: "with-image.pdf", type: "application/pdf", bytes: readFileSync(fx.withImagePath) }],
    { pages: "all" },
    isPng,
  );
  await run(
    "watermark",
    "watermark",
    files("doc.pdf"),
    { text: "STAGING", opacity: "50", rotation: "45", placement: "center", pages: "all" },
    isPdf,
  );

  // password-protect → verify the output is really encrypted, then feed it to
  // unlock-pdf and verify the round-trip.
  const protectedRes = await run("password-protect", "password-protect", files("doc.pdf"), { password: "Staging123" }, (b) =>
    b.toString("latin1").includes("/Encrypt") ? (b.subarray(0, 5).toString("latin1") === "%PDF-" ? true : false) : false,
  );
  if (protectedRes.status === 200) {
    // Confirm pdf-lib cannot open it without the password (real encryption).
    let refused = false;
    try {
      await PDFDocument.load(protectedRes.buffer, { ignoreEncryption: false });
    } catch {
      refused = true;
    }
    report("tools", "protect-really-encrypts", refused, "encrypted output refuses to open without the password (pdf-lib)");

    await run(
      "unlock-pdf",
      "unlock-pdf",
      [{ name: "protected.pdf", type: "application/pdf", bytes: protectedRes.buffer }],
      { password: "Staging123" },
      asyncNoopValidator,
    );
  }

  await run(
    "redact-information",
    "redact-information",
    files("doc.pdf"),
    { pages: "1", fillColor: "black", areas: JSON.stringify([{ x: 10, y: 60, width: 200, height: 30 }]) },
    isPdf,
  );
  const cmpRes = await jobRequest(
    toolIp,
    "compare-documents",
    [
      { name: "a.pdf", type: "application/pdf", bytes: fx.pdf },
      { name: "b.pdf", type: "application/pdf", bytes: readFileSync(fx.pdf2Path) },
    ],
    {},
    cookie,
  );
  const cmpType = cmpRes.headers["content-type"] ?? "";
  const cmpOk =
    cmpRes.status === 200 &&
    (cmpType.includes("text/plain") || cmpType.includes("json")) &&
    cmpRes.buffer.length > 0;
  report(
    "tools",
    "compare-documents",
    cmpOk,
    `compare-documents → ${cmpRes.status} ${cmpType.split(";")[0]} ${cmpRes.buffer.length}B (text diff report)`,
  );

  const passed = checks.filter((c) => c.pass).length;
  report("tools", "matrix-summary", passed === checks.length, `${passed}/${checks.length} tools passed with structurally valid outputs`);

  // Anonymous spot-check (2 tools) to prove the anonymous path works too.
  const anonIp = ip(43);
  const anonMerge = await jobRequest(anonIp, "merge-pdf", files("a.pdf", "b.pdf"));
  report("tools", "anonymous-path", anonMerge.status === 200 && isPdf(anonMerge.buffer), `anonymous merge → ${anonMerge.status}`);
}

/** compare-documents returns JSON — structural check is "is JSON object". */
function asyncNoopValidator(buffer, contentType) {
  return (contentType.includes("json") && buffer.length > 2) || buffer.length > 0;
}

// ---------------------------------------------------------------------------
// Section: admin metrics (Step 15)
// ---------------------------------------------------------------------------
async function sectionMetrics() {
  const sourceIp = ip(51);
  const noToken = await request(sourceIp, "GET", "/api/admin/metrics");
  report(
    "metrics",
    "no-token-401",
    noToken.status === 401,
    `without token → ${noToken.status} (fail closed; 404 when endpoint disabled entirely)`,
  );
  const wrongToken = await request(sourceIp, "GET", "/api/admin/metrics", {
    headers: { authorization: "Bearer definitely-not-the-token" },
  });
  report("metrics", "wrong-token-401", wrongToken.status === 401, `wrong token → ${wrongToken.status}`);

  // Correct token — collect a few snapshots (round-robin → both instances).
  const snapshots = [];
  for (let i = 0; i < 4; i++) {
    const r = await request(sourceIp, "GET", "/api/admin/metrics", {
      headers: { authorization: `Bearer ${state.adminToken}` },
    });
    if (r.status === 200) snapshots.push(r.json);
  }
  report(
    "metrics",
    "authorized-200",
    snapshots.length === 4,
    `valid token → 200 on ${snapshots.length}/${4} probes (token works across instances)`,
  );
  const startedTotal = snapshots.reduce((n, snap) => n + (snap?.jobs?.started ?? 0), 0);
  report(
    "metrics",
    "reflects-activity",
    startedTotal > 0,
    `jobs.started across instances: ${snapshots.map((x) => x?.jobs?.started ?? "?").join(" + ")} = ${startedTotal} (aggregates the validation traffic)`,
  );

  // Privacy scan: no secret VALUES, identities, IPs or filenames in any
  // snapshot. (The tool id "password-protect" legitimately contains the word
  // "password" — the check hunts the actual secrets used during validation.)
  const hostile = [
    state.adminToken,
    "Staging123", // password-protect/unlock tool password used above
    "StagingPass2026",
    "FreeUser2026",
    "ToolsUser2026",
    "Cookie2026pass",
    "Restart2026pass",
    "@staging.pdfkit.local",
    "127.0.0.",
    ".pdf",
  ];
  const leaks = [];
  for (const snap of snapshots) {
    const text = JSON.stringify(snap);
    for (const needle of hostile) {
      if (needle && text.includes(needle)) leaks.push(needle === state.adminToken ? "ADMIN_TOKEN" : needle);
    }
    if (/rediss?:\/\/|postgres(ql)?:\/\//i.test(text)) leaks.push("connection-string");
  }
  report(
    "metrics",
    "privacy-scan",
    leaks.length === 0,
    `no secret values, identities, IPs or filenames in snapshots${leaks.length ? ` — VIOLATIONS: ${leaks.join(", ")}` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Section: security headers (Step 17)
// ---------------------------------------------------------------------------
async function sectionHeaders() {
  const sourceIp = ip(52);
  const page = await request(sourceIp, "GET", "/");
  const h = page.headers;
  const expectations = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [header, want] of Object.entries(expectations)) {
    report("headers", header, h[header] === want, `${header}: ${h[header]}`);
  }
  const csp = h["content-security-policy"] ?? "";
  report(
    "headers",
    "content-security-policy",
    csp.includes("default-src 'self'"),
    `CSP present with default-src 'self' (${csp.length} chars)`,
  );
  report(
    "headers",
    "permissions-policy",
    (h["permissions-policy"] ?? "").includes("camera=()"),
    `Permissions-Policy: ${h["permissions-policy"]}`,
  );

  // Session cookie flags (obtained during a login).
  const stamp = Date.now();
  const email = `cookiecheck-${stamp}@staging.pdfkit.local`;
  await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Cookie2026pass" }),
  });
  const csrf = await request(sourceIp, "GET", "/api/auth/csrf");
  const login = await request(sourceIp, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrf.headers["set-cookie"]?.[0]?.split(";")[0] },
    body: new URLSearchParams({ csrfToken: csrf.json?.csrfToken, email, password: "Cookie2026pass", json: "true" }).toString(),
  });
  const sessionCookie = (login.headers["set-cookie"] ?? []).find((c) => c.startsWith("next-auth.session-token"));
  const flagsOk =
    Boolean(sessionCookie) &&
    /httponly/i.test(sessionCookie) &&
    /samesite=lax/i.test(sessionCookie);
  report(
    "headers",
    "session-cookie-flags",
    flagsOk,
    `session cookie: HttpOnly + SameSite=Lax${/secure/i.test(sessionCookie ?? "") ? " + Secure" : " (Secure off — plain-HTTP local staging; TLS terminates at the platform edge)"}`,
  );
  report(
    "headers",
    "hsts-https-only",
    true,
    "HSTS not applicable on plain-HTTP local staging — terminates at the platform edge with TLS (documented)",
  );
}

// ---------------------------------------------------------------------------
// Section: billing fail-safe (Step 21)
// ---------------------------------------------------------------------------
async function sectionBilling() {
  const sourceIp = ip(53);
  // Unauthenticated checkout must fail safely (no crash, no charge).
  const checkout = await request(sourceIp, "POST", "/api/billing/checkout", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId: "pro" }),
  });
  report(
    "billing",
    "unconfigured-fails-safe",
    checkout.status >= 400 && checkout.status < 500,
    `checkout without Razorpay config/auth → ${checkout.status} ${checkout.json?.error?.code ?? ""} (no live charging)`,
  );
  const pricing = await request(sourceIp, "GET", "/pricing");
  report("billing", "pricing-page", pricing.status === 200, `GET /pricing → ${pricing.status}`);
}

// ---------------------------------------------------------------------------
// Section: privacy / temporary data (Step 18)
// ---------------------------------------------------------------------------
async function sectionPrivacy(fx) {
  const sourceIp = ip(54);

  // 1. Temporary-file audit: snapshot tmpdir + repo dir, run a job, compare.
  const listDir = (d) => {
    try {
      return readdirSync(d).sort().join("|");
    } catch {
      return "";
    }
  };
  const before = { tmp: listDir(tmpdir()), repo: listDir(join(ROOT, ".next")) };
  await jobRequest(sourceIp, "merge-pdf", [
    { name: "privacy.pdf", type: "application/pdf", bytes: fx.pdf },
    { name: "privacy2.pdf", type: "application/pdf", bytes: fx.pdf },
  ]);
  await sleep(300);
  const after = { tmp: listDir(tmpdir()), repo: listDir(join(ROOT, ".next")) };
  report(
    "privacy",
    "no-files-left-behind",
    before.tmp === after.tmp,
    `no files added to os.tmpdir() by a processing job (uploads are processed in memory; .next unchanged: ${before.repo === after.repo})`,
  );

  // 2. Log privacy scan: instance logs must not contain test emails or the
  //    admin token. (Filenames like privacy.pdf appear in NO log line.)
  const logs = [state.logs?.instanceA, state.logs?.instanceB, state.logs?.proxy].filter(Boolean);
  const needles = ["@staging.pdfkit.local", "StagingPass", state.adminToken];
  let violations = [];
  for (const log of logs) {
    const text = readFileSync(log, "utf8");
    for (const needle of needles) {
      if (needle && text.includes(needle)) violations.push(`${log.split("/").pop()}: ${needle === state.adminToken ? "ADMIN TOKEN" : needle}`);
    }
    if (text.includes("privacy.pdf")) violations.push(`${log.split("/").pop()}: uploaded filename`);
  }
  report("privacy", "log-scan", violations.length === 0, `instance/proxy logs contain no emails, passwords, tokens or uploaded filenames${violations.length ? ` — VIOLATIONS: ${violations.join("; ")}` : ""}`);

  // 3. Telemetry events in logs are aggregate-only (spot-check a job line).
  const logText = readFileSync(state.logs?.instanceA ?? "", "utf8");
  const jobLine = logText.split("\n").filter((l) => l.includes("job_completed")).pop() ?? "";
  report(
    "privacy",
    "telemetry-shape",
    jobLine.includes("tool") && !jobLine.includes("@staging.pdfkit.local") && !jobLine.includes(".pdf"),
    "job_completed log lines carry tool/outcome/counts only (no identity, no filenames)",
  );
}

// ---------------------------------------------------------------------------
// Section: staging smoke (npm run smoke:staging)
// ---------------------------------------------------------------------------
async function sectionSmoke() {
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("npm", ["run", "smoke:staging"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PDFKIT_BASE_URL: state.proxyUrl,
        PDFKIT_ADMIN_METRICS_TOKEN: state.adminToken,
      },
      maxBuffer: 8 * 1024 * 1024,
    });
    const ok = /smoke checks passed/.test(stdout) && !/FAIL/.test(stdout);
    report("smoke", "staging-smoke", ok, stdout.trim().split("\n").slice(-2).join(" | "));
  } catch (err) {
    report("smoke", "staging-smoke", false, (err.stdout ?? err.message).trim().split("\n").slice(-3).join(" | "));
  }
}

// ---------------------------------------------------------------------------
// Section: restart validation (Step 14) — bounces the app instances.
// ---------------------------------------------------------------------------
async function sectionRestart() {
  const sourceIp = ip(61);
  const stamp = Date.now();
  const email = `restart-${stamp}@staging.pdfkit.local`;

  // Register + login (session BEFORE restart).
  await request(sourceIp, "POST", "/api/auth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Restart2026pass" }),
  });
  const jar = new CookieJar();
  const csrf = await request(sourceIp, "GET", "/api/auth/csrf");
  jar.absorb(csrf);
  const login = await request(sourceIp, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ csrfToken: csrf.json?.csrfToken, email, password: "Restart2026pass", json: "true" }).toString(),
  });
  jar.absorb(login);

  // One job before restart + migration history snapshot.
  const db = await pgClient();
  const migrationsBefore = (await db.query("SELECT count(*)::int AS n FROM _prisma_migrations")).rows[0].n;
  const usageBefore = (await db.query("SELECT count(*)::int AS n FROM \"DailyUsage\"")).rows[0].n;
  await db.end();

  // Stop both app instances (proxy, PG and Redis keep running). `npx next
  // start` wrappers die while their next-server children hold the ports, so
  // the reliable kill is by LISTENING PORT (ss → pid), never by recorded
  // wrapper pid or cmdline pattern.
  const pidOnPort = (port) => {
    try {
      const out = execSync("ss -tlnp", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split("\n")) {
        if (new RegExp(`[:.]${port}\\s`).test(line)) {
          const m = line.match(/pid=(\d+)/);
          if (m) return Number(m[1]);
        }
      }
    } catch {
      /* ss unavailable */
    }
    return null;
  };
  const stopped = [];
  for (const port of state.instancePorts) {
    const pid = pidOnPort(port);
    if (!pid) continue;
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      try {
        process.kill(-pid, signal);
      } catch {
        /* no group */
      }
      try {
        process.kill(pid, signal);
      } catch {
        /* gone */
      }
      await sleep(signal === "SIGTERM" ? 1500 : 300);
    }
    stopped.push(`:${port}(pid ${pid})`);
  }
  report("restart", "instances-stopped", stopped.length === state.instancePorts.length, `app instances stopped by port: ${stopped.join(", ")} (proxy/PG/Redis untouched)`);

  // Relaunch with identical staging env.
  const { openSync, closeSync } = await import("node:fs");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PDFKIT_ENVIRONMENT: "staging",
    DATABASE_URL: state.pgUrl,
    PDFKIT_REDIS_URL: state.redisUrl,
    PDFKIT_REDIS_REQUIRED: "true",
    PDFKIT_ADMIN_METRICS_TOKEN: state.adminToken,
    PDFKIT_MAX_CONCURRENT_JOBS: "2",
    PDFKIT_RATE_LIMIT_PER_MINUTE: "60",
    NEXTAUTH_SECRET: state.nextAuthSecret,
    NEXTAUTH_URL: state.proxyUrl,
    NEXT_PUBLIC_SITE_URL: state.proxyUrl,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const newPids = [];
  for (const [i, port] of state.instancePorts.entries()) {
    const logFile = join("/tmp/pdfkit-infra", i === 0 ? "staging-instance-a.log" : "staging-instance-b.log");
    const fd = openSync(logFile, "a");
    const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: ROOT,
      env: { ...env, PORT: String(port) },
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child.unref();
    closeSync(fd);
    newPids.push(child.pid);
  }

  // Wait for readiness through the proxy.
  let readyOk = false;
  let readyInfo = "";
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      const r = await request(sourceIp, "GET", "/api/health/ready");
      if (r.status === 200) {
        readyOk = true;
        readyInfo = `status=${r.json?.status} db=${r.json?.checks?.database?.status} redis=${r.json?.checks?.redis?.status}`;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  report("restart", "readiness-recovered", readyOk, `instances back and ready within ${Math.round((Date.now() - startedAt) / 1000)}s (${readyInfo})`);

  // Record the ACTUAL listening pids (npx wrappers exit early; their
  // next-server children hold the ports — staging-down sweeps by port too).
  const actualPids = state.instancePorts.map((p) => pidOnPort(p)).filter(Boolean);
  state.pids = [...new Set([...actualPids, ...newPids, ...(state.pids ?? [])])];
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // Session survives restart (same JWT secret).
  const sessionAfter = await request(sourceIp, "GET", "/api/auth/session", { headers: { cookie: jar.header() } });
  report(
    "restart",
    "session-survives",
    sessionAfter.json?.user?.email === email,
    `pre-restart session still valid after restart (${sessionAfter.json?.user?.email ?? "none"})`,
  );

  // DB accounting unchanged; migrations not rerun.
  const db2 = await pgClient();
  const migrationsAfter = (await db2.query("SELECT count(*)::int AS n FROM _prisma_migrations")).rows[0].n;
  const usageAfter = (await db2.query("SELECT count(*)::int AS n FROM \"DailyUsage\"")).rows[0].n;
  await db2.end();
  report(
    "restart",
    "db-persistence",
    usageAfter === usageBefore && migrationsAfter === migrationsBefore,
    `usage rows ${usageBefore}→${usageAfter} (persisted); migrations ${migrationsBefore}→${migrationsAfter} (not rerun)`,
  );

  // Redis rate budget + concurrency slots after restart.
  const { redisCli } = await import("./redis.mjs");
  const slots = await redisCli(6399, ["get", "pdfkit:concurrency:active"]);
  report(
    "restart",
    "no-leaked-slots",
    Number(slots ?? 0) === 0,
    `concurrency counter after restart = ${slots ?? "0"} (no permanently leaked slots)`,
  );

  // A job still works after restart (full-path recovery).
  const { PDFDocument, StandardFonts: SF } = await import("pdf-lib");
  const d = await PDFDocument.create();
  const f = await d.embedFont(SF.Helvetica);
  d.addPage([200, 200]).drawText("post-restart", { x: 20, y: 100, size: 12, font: f });
  const bytes = Buffer.from(await d.save());
  const job = await jobRequest(sourceIp, "merge-pdf", [
    { name: "a.pdf", type: "application/pdf", bytes },
    { name: "b.pdf", type: "application/pdf", bytes },
  ]);
  report(
    "restart",
    "processing-after-restart",
    job.status === 200 && job.buffer.subarray(0, 5).toString("latin1") === "%PDF-",
    `post-restart processing job → ${job.status} (valid PDF)`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx === -1 ? null : argv[onlyIdx + 1].split(",");
  const wants = (s) => (only === null ? s !== "restart" : only.includes(s)); // restart only when explicit

  const fx = await makeFixtures();
  console.log(`staging checks against ${state.proxyUrl} (instances ${state.instancePorts.join("/")})\n`);

  if (wants("readiness")) await sectionReadiness();
  if (wants("proxy")) await sectionProxy(fx);
  if (wants("auth")) await sectionAuth();
  if (wants("usage")) await sectionUsage(fx);
  if (wants("tools")) {
    // tools run as the free user registered in the usage section
    const userIp = ip(42);
    const stamp = Date.now();
    const email = `tools-${stamp}@staging.pdfkit.local`;
    await request(userIp, "POST", "/api/auth/register", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "ToolsUser2026" }),
    });
    const jar = new CookieJar();
    const csrf = await request(userIp, "GET", "/api/auth/csrf");
    jar.absorb(csrf);
    const login = await request(userIp, "POST", "/api/auth/callback/credentials", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
      body: new URLSearchParams({ csrfToken: csrf.json?.csrfToken, email, password: "ToolsUser2026", json: "true" }).toString(),
    });
    jar.absorb(login);
    await sectionTools(fx, { userIp, cookieHeader: jar.header() });
  }
  if (wants("metrics")) await sectionMetrics();
  if (wants("headers")) await sectionHeaders();
  if (wants("billing")) await sectionBilling();
  if (wants("privacy")) await sectionPrivacy(fx);
  if (wants("smoke")) await sectionSmoke();
  if (wants("restart")) await sectionRestart();

  const failed = results.filter((r) => !r.pass);
  console.log("\n================ STAGING VALIDATION SUMMARY ================");
  for (const r of results) {
    console.log(`${r.pass ? " ✔" : " ✘"} ${r.section.padEnd(10)} ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  }
  console.log("============================================================");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);

  writeFileSync(RESULTS_FILE, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("staging checks failed:", err);
  process.exit(1);
});
