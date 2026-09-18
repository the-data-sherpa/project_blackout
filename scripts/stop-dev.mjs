import { readdir, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

if (process.platform !== "linux") {
  console.error("dev:stop requires Linux. Use Ctrl+C in the dev terminal.");
  process.exit(1);
}

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const packages = new Set([
  `${root}/package.json`,
  `${root}/packages/contracts/package.json`,
]);
const scripts = new Set(["dev", "dev:server", "dev:web"]);

async function identity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // The command name can contain spaces and parentheses; fields start after it.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

async function findTargets() {
  const matches = await Promise.all(
    (await readdir("/proc"))
      .filter((pid) => /^\d+$/.test(pid) && Number(pid) !== process.pid)
      .map(async (pid) => {
        try {
          const started = await identity(pid);
          const cwd = await realpath(`/proc/${pid}/cwd`);
          if (cwd !== root && !cwd.startsWith(`${root}/`)) return null;
          const environment = (await readFile(`/proc/${pid}/environ`, "utf8"))
            .split("\0")
            .map((entry) => {
              const separator = entry.indexOf("=");
              return [entry.slice(0, separator), entry.slice(separator + 1)];
            });
          const env = Object.fromEntries(environment);
          if (
            !packages.has(env.npm_package_json) ||
            !scripts.has(env.npm_lifecycle_event)
          ) {
            return null;
          }
          return started ? { pid: Number(pid), started } : null;
        } catch (error) {
          if (["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) {
            return null;
          }
          throw error;
        }
      }),
  );
  return matches.filter(Boolean);
}

async function alive(target) {
  return (await identity(target.pid)) === target.started;
}

async function signal(target, name) {
  if (!(await alive(target))) return;
  try {
    process.kill(target.pid, name);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

let remaining = await findTargets();
if (remaining.length === 0) {
  console.log("No BLACKOUT dev processes are running in this checkout.");
} else {
  const deadline = Date.now() + 5000;
  const signalled = new Set();
  while (remaining.length && Date.now() < deadline) {
    await Promise.all(
      remaining.map(async (target) => {
        const key = `${target.pid}:${target.started}`;
        if (signalled.has(key)) return;
        await signal(target, "SIGTERM");
        signalled.add(key);
      }),
    );
    await setTimeout(100);
    // Watchers can finish spawning a child while the first signals are delivered.
    remaining = await findTargets();
  }
  await Promise.all(remaining.map((target) => signal(target, "SIGKILL")));
  if (remaining.length) {
    await setTimeout(100);
    if ((await findTargets()).length) {
      throw new Error("Some BLACKOUT dev processes have not exited yet.");
    }
  }
  console.log("Stopped BLACKOUT dev processes in this checkout.");
}
