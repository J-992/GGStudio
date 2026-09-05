// Portal submission gate.
//
// Poki, CrazyGames and itch serve a game from a subdirectory inside an iframe, never
// from the domain root. The dev server and `vite preview` both serve from "/", so a
// build with absolute asset URLs passes every local check and still 404s on the portal,
// which reads as "this version seems broken". This script serves dist/ from a nested
// path, frames it, and fails if the game does not reach its title screen.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = 5233;
const SUBPATH = "/en/games/tether-run";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const framePage = `<!doctype html><meta charset="utf-8"><title>portal</title>
<style>html,body{margin:0;height:100%;background:#111}iframe{width:100%;height:100%;border:0}</style>
<iframe src="${SUBPATH}/index.html" allow="autoplay; fullscreen; gamepad"></iframe>`;

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
}

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/portal.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(framePage);
  }
  if (!url.startsWith(SUBPATH + "/")) {
    res.writeHead(404).end("not found");
    return;
  }
  const rel = normalize(url.slice(SUBPATH.length + 1)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));

const html = await readFile(join(root, "index.html"), "utf8");
check("no root-absolute asset URLs in dist/index.html", !/(?:src|href)="\//.test(html.replace(/href="data:[^"]*"/g, "")));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const failedRequests = [];
const errors = [];
page.on("requestfailed", (r) => failedRequests.push(r.url()));
page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:${PORT}/portal.html`, { waitUntil: "load" });
const frame = page.frames().find((f) => f.url().includes(SUBPATH));

let titleVisible = false;
try {
  await frame.waitForFunction(
    () => getComputedStyle(document.getElementById("loading")).display === "none",
    null,
    { timeout: 20000 },
  );
  titleVisible = await frame.isVisible("#btn-local");
} catch { /* reported by the check below */ }

check("game boots from a subpath inside an iframe", titleVisible);
check("no failed asset requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(", "));
process.exit(failed.length ? 1 : 0);
