#!/usr/bin/env node
/**
 * Phase 65 — stop the local staging stack started by staging-up.mjs.
 * Stops the proxy and both app instances (SIGTERM, then SIGKILL), the
 * PostgreSQL cluster and Redis. The PostgreSQL data dir is PERSISTENT
 * (staging semantics) and is kept unless --reset-data is given (which
 * removes the cluster directory).
 *
 * Phase 65 validation finding: `npx next start` wrappers exit early while
 * their `next-server` CHILD processes keep running and hold the ports, so
 * killing only the recorded wrapper PIDs leaves stale instances serving
 * traffic (observed: old instances kept ports 3101/3102 after a restart,
 * serving a stale build with stale secrets). Teardown therefore:
 *   1. signals the recorded PIDs' PROCESS GROUPS (children included),
 *   2. sweeps any process still LISTENING on the instance/proxy ports
 *      (identified via ss, killed by exact PID — never a blind pkill).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const STATE_FILE = "/tmp/pdfkit-infra/staging-state.json";

/** PID listening on a TCP port (ss reports PIDs for our own processes). */
function pidOnPort(port) {
  try {
    const out = execFileSync("ss", ["-tlnp"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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
}

/** SIGTERM→SIGKILL a PID and (best effort) its process group. */
async function stopPid(pid) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-pid, signal); // process group (children included)
    } catch {
      /* no group or already gone */
    }
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, signal === "SIGTERM" ? 1500 : 300));
  }
}

export async function stopStagingStack(state) {
  // 1. Recorded PIDs (wrappers, proxy) and their groups.
  for (const pid of state.pids ?? []) await stopPid(pid);

  // 2. Port sweep — catches next-server children that outlived wrappers.
  const ports = [...(state.instancePorts ?? []), state.proxyUrl ? new URL(state.proxyUrl).port : null].filter(Boolean);
  const swept = [];
  for (const port of ports) {
    const pid = pidOnPort(port);
    if (pid) {
      await stopPid(pid);
      swept.push(`:${port}(pid ${pid})`);
    }
  }
  if (swept.length) console.log(`[staging-down] port sweep stopped stale listeners: ${swept.join(", ")}`);

  // 3. PostgreSQL (data kept) and Redis.
  if (state.pgDataDir) {
    const bin = "node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl";
    try {
      await execFileAsync(bin, ["-D", state.pgDataDir, "-m", "fast", "stop"], { cwd: process.cwd() });
      console.log("postgres stopped (data dir kept)");
    } catch (err) {
      console.log("postgres stop:", err.message.split("\n")[0]);
    }
  }
  const { stopRedisByPort } = await import("./redis.mjs");
  if (state.redisUrl) {
    const port = new URL(state.redisUrl).port;
    await stopRedisByPort(Number(port));
    console.log(`redis stopped (:${port})`);
  }
}

async function main() {
  if (!existsSync(STATE_FILE)) {
    console.log("no staging state found — nothing to stop");
    process.exit(0);
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  await stopStagingStack(state);

  if (process.argv.includes("--reset-data") && state.pgDataDir) {
    rmSync(state.pgDataDir, { recursive: true, force: true });
    console.log("postgres data dir removed");
  }
  console.log("staging stack stopped");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
