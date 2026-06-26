import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendWorkerLog, storePaths } from "./lib/phone-order-store.mjs";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const lockPath = path.join(storePaths.dataDir, "phone-order-scheduled-cycle.lock");
const staleLockMs = 10 * 60 * 1000;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeOrphanedLockIfNeeded() {
  const info = await stat(lockPath).catch(() => null);
  if (!info) {
    return;
  }

  if (Date.now() - info.mtimeMs > staleLockMs) {
    await rm(lockPath, { force: true }).catch(() => {});
    return;
  }

  const raw = await readFile(lockPath, "utf8").catch(() => "");
  if (!raw.trim()) {
    await rm(lockPath, { force: true }).catch(() => {});
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isProcessAlive(Number(parsed?.pid))) {
      await rm(lockPath, { force: true }).catch(() => {});
    }
  } catch {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const args = {
    limit: 10,
    skipLock: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      args.limit = Math.max(1, Number(argv[++index] || 10));
    } else if (arg === "--skip-lock") {
      args.skipLock = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runNodeScript(scriptPath, scriptArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: workspaceRoot,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function ensureLock() {
  if (existsSync(lockPath)) {
    await removeOrphanedLockIfNeeded();
  }

  const handle = await open(lockPath, "wx");
  await handle.writeFile(
    `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  await handle.close();
}

async function releaseLock() {
  await rm(lockPath, { force: true }).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipLock) {
    try {
      await ensureLock();
    } catch {
      console.log("Scheduled cycle skipped because another run still holds the lock.");
      await appendWorkerLog({
        event_type: "scheduled_cycle_skipped_locked",
        note: "Skipped because phone-order-scheduled-cycle.lock already exists.",
      });
      return;
    }
  }

  const startedAt = new Date().toISOString();

  try {
    await appendWorkerLog({
      event_type: "scheduled_cycle_started",
      note: `Started scheduled phone-order cycle with limit=${args.limit}.`,
    });

    await runNodeScript("scripts/fetch-phone-order-inbox.mjs", []);
    await runNodeScript("scripts/import-phone-order-requests.mjs", []);
    await runNodeScript("scripts/sync-phone-order-sapo-statuses.mjs", []);
    await runNodeScript("scripts/process-phone-order-requests.mjs", []);
    await runNodeScript("scripts/run-phone-order-omni-session-queue.mjs", [
      "--limit",
      String(args.limit),
    ]);

    const summary = {
      ok: true,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      limit: args.limit,
      lock_path: lockPath,
    };

    await writeFile(
      path.join(storePaths.dataDir, "phone-order-scheduled-cycle-last.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );

    await appendWorkerLog({
      event_type: "scheduled_cycle_completed",
      note: `Completed scheduled phone-order cycle with limit=${args.limit}.`,
    });

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await appendWorkerLog({
      event_type: "scheduled_cycle_failed",
      note: message,
    });

    throw error;
  } finally {
    if (!args.skipLock) {
      await releaseLock();
    }
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
