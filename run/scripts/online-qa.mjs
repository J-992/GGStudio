import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const PORT = 5219;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "pipe",
});

let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("vite timeout")), 20000);
    server.stdout.on("data", (data) => {
      if (data.toString().includes("Local:")) { clearTimeout(timeout); resolve(); }
    });
    server.stderr.on("data", (data) => process.stderr.write(data));
  });

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const host = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  const guest = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  const errors = [];
  for (const page of [host, guest]) {
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") console.log(`[browser ${message.type()}] ${message.text()}`);
    });
    await page.goto(BASE + "/?bot=1&poki=mock", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
  }

  await host.click("#btn-online");
  await host.click("#btn-host");
  await host.waitForFunction(() => document.getElementById("online-code")?.textContent?.trim().length >= 4, null, { timeout: 20000 });
  const code = (await host.textContent("#online-code")).trim();
  console.log(`room created: ${code}`);
  await host.waitForTimeout(1500);

  await guest.click("#btn-online");
  await guest.fill("#room-code", code);
  await guest.click("#btn-join");
  await guest.waitForTimeout(3000);
  console.log("host status:", await host.textContent("#online-status"));
  console.log("guest status:", await guest.textContent("#online-status"));
  await host.waitForFunction(() => window.__TR__.snapshot().state === "Playing", null, { timeout: 25000 });
  await guest.waitForFunction(() => window.__TR__.snapshot().state === "Playing", null, { timeout: 25000 });

  const before = (await host.evaluate(() => window.__TR__.snapshot())).p2.x;
  await guest.keyboard.down("KeyD");
  await guest.waitForTimeout(900);
  await guest.keyboard.up("KeyD");
  await host.waitForTimeout(250);
  const after = (await host.evaluate(() => window.__TR__.snapshot())).p2.x;

  if (after <= before + 0.5) throw new Error(`guest input did not move player 2 (${before} -> ${after})`);
  await guest.keyboard.press("Escape");
  await host.waitForFunction(() => window.__TR__.snapshot().state === "Paused", null, { timeout: 5000 });
  await guest.waitForFunction(() => window.__TR__.snapshot().state === "Paused", null, { timeout: 5000 });
  await guest.keyboard.press("Escape");
  await host.waitForFunction(() => window.__TR__.snapshot().state === "Playing", null, { timeout: 5000 });
  await guest.waitForFunction(() => window.__TR__.snapshot().state === "Playing", null, { timeout: 5000 });
  const guestLifecycle = await guest.evaluate(() => window.__POKI_EVENTS__.filter((event) => !event.startsWith("measure:")));
  if (guestLifecycle.slice(-3).join(",") !== "gameplayStop,commercialBreak,gameplayStart") {
    throw new Error(`guest Poki lifecycle did not follow host pause: ${guestLifecycle.join(",")}`);
  }
  if (errors.length) throw new Error(errors.join(" | "));
  console.log(`PASS online room ${code}: joined, synced input, and synchronized pause/resume lifecycle`);
} finally {
  await browser?.close();
  server.kill();
}
