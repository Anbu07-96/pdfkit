#!/usr/bin/env node
/**
 * Phase 65 staging reverse proxy (provider-neutral reference).
 *
 * A REAL HTTP reverse proxy in front of the PDFKit instances, modeling what
 * managed platform proxies (Render/Railway/Fly/Cloudflare/nginx) do:
 *
 *   - terminates the client TCP connection and opens its own to the app;
 *   - APPENDS the client's socket remote address to X-Forwarded-For (the
 *     standard appending behavior — a client-supplied prefix may remain, the
 *     proxy-added tail is authoritative);
 *   - sets X-Forwarded-Proto and X-Forwarded-Host;
 *   - STRIPS client-supplied CF-Connecting-IP and X-Real-IP (spoofed copies
 *     must not survive the edge);
 *   - round-robins across the configured app instances.
 *
 * This lets the staging validation observe genuine proxied traffic: the app
 * instances are NOT directly exposed (they bind 127.0.0.1), exactly like a
 * managed deployment where only the platform proxy is public.
 *
 * Usage:
 *   node scripts/infra/staging-proxy.mjs --port 3080 --target 3101 --target 3102
 */
import { createServer, request as httpRequest } from "node:http";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}
function argValues(name) {
  return args
    .map((a, i) => (a === `--${name}` ? args[i + 1] : null))
    .filter((v) => v !== null && v !== undefined)
    .map((v) => Number(v));
}

const PORT = Number(argValue("port", "3080"));
const TARGETS = argValues("target");

if (!Number.isFinite(PORT) || TARGETS.length === 0) {
  console.error("usage: staging-proxy.mjs --port <port> --target <port> [--target <port> ...]");
  process.exit(2);
}

let next = 0;
const proxied = { total: 0, byTarget: new Map(TARGETS.map((t) => [t, 0])) };

const server = createServer((req, res) => {
  const targetPort = TARGETS[next % TARGETS.length];
  next += 1;

  const clientIp = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "127.0.0.1";

  const headers = { ...req.headers };
  // Strip spoofable identity headers at the edge (managed proxies do the
  // same for the headers they own).
  delete headers["cf-connecting-ip"];
  delete headers["x-real-ip"];

  // Append the socket address (standard appending proxy behavior).
  const prior = (req.headers["x-forwarded-for"] ?? "").toString().trim();
  headers["x-forwarded-for"] = prior ? `${prior}, ${clientIp}` : clientIp;
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-host"] = req.headers.host ?? `127.0.0.1:${PORT}`;

  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      proxied.total += 1;
      proxied.byTarget.set(targetPort, (proxied.byTarget.get(targetPort) ?? 0) + 1);
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message: "staging proxy: upstream unavailable" } }));
    console.error(`[proxy] upstream :${targetPort} error:`, err.message);
  });

  req.pipe(upstream);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[proxy] listening on 0.0.0.0:${PORT} → ${TARGETS.map((t) => `127.0.0.1:${t}`).join(", ")} (round-robin)`);
});

// Health/observability endpoint on a private port for the validation harness.
const ADMIN_PORT = PORT + 1;
createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ total: proxied.total, byTarget: Object.fromEntries(proxied.byTarget) }));
}).listen(ADMIN_PORT, "127.0.0.1", () => {
  console.log(`[proxy] stats on 127.0.0.1:${ADMIN_PORT}/ (private)`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
