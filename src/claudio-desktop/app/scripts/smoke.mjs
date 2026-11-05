import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [executable, ...extraArgs] = process.argv.slice(2);
if (!executable) {
  console.error("usage: node scripts/smoke.mjs <packaged executable> [args...]");
  process.exit(2);
}

const port = 9400 + Math.floor(Math.random() * 400);
const dataHome = mkdtempSync(path.join(tmpdir(), "claudio-smoke-"));
const child = spawn(executable, [...extraArgs, `--remote-debugging-port=${port}`], {
  env: { ...process.env, XDG_DATA_HOME: dataHome },
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
});
let exited = false;

function killGroup(signal) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    return;
  }
}

child.on("exit", () => {
  exited = true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage(deadline) {
  while (Date.now() < deadline) {
    if (exited) throw new Error("the app exited before a window appeared");
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      await sleep(500);
    }
    await sleep(250);
  }
  throw new Error("no window appeared in time");
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("could not attach to the window"));
  });
  const answer = await new Promise((resolve) => {
    socket.onmessage = (message) => resolve(JSON.parse(message.data));
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  socket.close();
  if (answer.result?.exceptionDetails)
    throw new Error(JSON.stringify(answer.result.exceptionDetails));
  return answer.result?.result?.value;
}

async function waitFor(page, expression, deadline) {
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(page, expression).catch((error) => String(error));
    if (last === true) return;
    await sleep(500);
  }
  throw new Error(`condition never became true: ${expression} (last: ${JSON.stringify(last)})`);
}

let failure = null;
try {
  const deadline = Date.now() + 90_000;
  const page = await findPage(deadline);
  await waitFor(page, 'typeof window.claudioDesktop?.invoke === "function"', deadline);
  const ping = await evaluate(page, 'window.claudioDesktop.invoke("ping")');
  if (ping?.platform !== (process.platform === "win32" ? "windows" : process.platform))
    throw new Error(`unexpected ping: ${JSON.stringify(ping)}`);
  await waitFor(page, 'document.querySelector("#root")?.childElementCount > 0', deadline);
  console.log(`smoke test passed: ${JSON.stringify(ping)}`);
} catch (error) {
  failure = error;
  console.error(`smoke test failed: ${error.message}`);
} finally {
  killGroup("SIGTERM");
  await sleep(1000);
  killGroup("SIGKILL");
  rmSync(dataHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(failure ? 1 : 0);
