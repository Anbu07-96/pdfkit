/**
 * Phase 64 infrastructure helper: Redis lifecycle.
 *
 * Prefers a real `redis-server` on PATH; falls back to the locally compiled
 * one (built from the official redis 7.2.5 source tarball during the Phase
 * 64 environment bootstrap — no apt/docker required, see
 * docs/distributed-infrastructure-validation.md). Starts a disposable,
 * persistence-free instance on a private port.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createConnection } from "node:net";

const execFileAsync = promisify(execFile);

const COMPILED_PATH = "/tmp/pdfkit-infra/redis-7.2.5/src/redis-server";

/**
 * @typedef {Object} RedisInstance
 * @property {string} url
 * @property {() => Promise<void>} stop
 */

async function probePort(host, port, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host, port }, () => {
          socket.end();
          resolve();
        });
        socket.on("error", reject);
        socket.setTimeout(500, () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`redis on ${host}:${port} did not become reachable within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

async function isRedisResponding(port) {
  try {
    const { stdout } = await execFileAsync(
      await redisCliPath(),
      ["-p", String(port), "ping"],
      { timeout: 2000 },
    );
    return stdout.trim() === "PONG";
  } catch {
    return false;
  }
}

async function redisServerPath() {
  // 1. System redis-server
  try {
    const { stdout } = await execFileAsync("which", ["redis-server"]);
    if (stdout.trim()) return stdout.trim();
  } catch {
    /* not on PATH */
  }
  // 2. Locally compiled (Phase 64 bootstrap)
  if (existsSync(COMPILED_PATH)) return COMPILED_PATH;
  throw new Error(
    "No redis-server available. Install redis on PATH, or compile the bootstrap copy: " +
      "see docs/distributed-infrastructure-validation.md (official source tarball, make MALLOC=libc).",
  );
}

async function redisCliPath() {
  try {
    const { stdout } = await execFileAsync("which", ["redis-cli"]);
    if (stdout.trim()) return stdout.trim();
  } catch {
    /* not on PATH */
  }
  const cli = "/tmp/pdfkit-infra/redis-7.2.5/src/redis-cli";
  if (existsSync(cli)) return cli;
  throw new Error("No redis-cli available (PATH or compiled bootstrap copy).");
}

/**
 * Start a disposable Redis (no persistence) on the given port. If something
 * is already answering PING on that port, it is reused (harness idempotence).
 *
 * @param {object} options
 * @param {number} options.port
 * @returns {Promise<RedisInstance>}
 */
export async function startRedis(options) {
  const { port } = options;

  if (await isRedisResponding(port)) {
    return {
      url: `redis://127.0.0.1:${port}/0`,
      async stop() {
        /* pre-existing instance — not ours to stop */
      },
    };
  }

  const serverPath = await redisServerPath();
  const child = spawn(serverPath, [
    "--port", String(port),
    "--bind", "127.0.0.1",
    "--save", "",
    "--appendonly", "no",
    "--daemonize", "no",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  child.stderr?.on("data", () => {
    /* keep the pipe drained; logs are not needed for the harness */
  });
  child.stdout?.on("data", () => {
    /* keep the pipe drained */
  });

  await probePort("127.0.0.1", port);

  return {
    url: `redis://127.0.0.1:${port}/0`,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 5000).unref?.();
      });
    },
  };
}

/**
 * Hard-stop a redis by port (outage scenarios) — only works for instances
 * started by this module (process handle) or via redis-cli SHUTDOWN NOSAVE.
 */
export async function stopRedisByPort(port) {
  try {
    await execFileAsync(await redisCliPath(), ["-p", String(port), "shutdown", "nosave"], {
      timeout: 2000,
    });
  } catch {
    /* already down or refused the command */
  }
}

/**
 * Issue an arbitrary redis-cli command; returns trimmed stdout.
 * Throws on non-zero exit — the caller decides how to report it.
 */
export async function redisCli(port, args) {
  const cli = await redisCliPath();
  const { stdout } = await execFileAsync(cli, ["-p", String(port), ...args], { timeout: 5000 });
  return stdout.trim();
}
