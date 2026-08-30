// Minimal zero-dependency Chrome DevTools Protocol client.
// Node 22 ships a global WebSocket, so this needs nothing from npm.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** First Chrome/Chromium/Edge found on this machine. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const candidates = process.platform === 'win32'
    ? [
        `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome/Chromium/Edge found. Set CHROME_PATH to the browser executable.',
    );
  }
  return found;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function launchChrome({ port = 9333, headless = true, width = 1280, height = 720 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-profile-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-search-engine-choice-screen',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    // Software WebGL so headless still gets a real GL context.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const proc = spawn(findChrome(), args, { stdio: 'ignore', detached: false });

  // Wait for the debugging endpoint to answer.
  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { version = await res.json(); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!version) {
    proc.kill();
    throw new Error('Chrome did not expose a debugging port');
  }

  return {
    proc,
    wsUrl: version.webSocketDebuggerUrl,
    userAgent: version['User-Agent'],
    product: version.Browser,
    close() {
      try { proc.kill(); } catch { /* already gone */ }
      setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 500);
    },
  };
}

export class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg.method, msg.params, msg.sessionId);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    });
    return new CdpConnection(ws);
  }

  on(fn) { this.listeners.push(fn); }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

/** Evaluate an expression in the page and return its JSON value. Throws on page-side errors. */
export async function evaluate(cdp, session, expression, { awaitPromise = true } = {}) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  }, session);
  if (res.exceptionDetails) {
    const e = res.exceptionDetails;
    throw new Error(`page error: ${e.exception?.description ?? e.text}`);
  }
  return res.result.value;
}

const KEYS = {
  KeyW: { code: 'KeyW', key: 'w', vk: 87, text: 'w' },
  KeyA: { code: 'KeyA', key: 'a', vk: 65, text: 'a' },
  KeyS: { code: 'KeyS', key: 's', vk: 83, text: 's' },
  KeyD: { code: 'KeyD', key: 'd', vk: 68, text: 'd' },
  KeyR: { code: 'KeyR', key: 'r', vk: 82, text: 'r' },
  KeyM: { code: 'KeyM', key: 'm', vk: 77, text: 'm' },
  Space: { code: 'Space', key: ' ', vk: 32, text: ' ' },
  Escape: { code: 'Escape', key: 'Escape', vk: 27, text: '' },
  F2: { code: 'F2', key: 'F2', vk: 113, text: '' },
};

export async function key(cdp, session, name, type) {
  const k = KEYS[name];
  if (!k) throw new Error(`unknown key ${name}`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: type === 'down' ? 'keyDown' : 'keyUp',
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
    code: k.code,
    key: k.key,
    text: type === 'down' ? k.text : undefined,
    unmodifiedText: type === 'down' ? k.text : undefined,
  }, session);
}

export async function click(cdp, session, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
    }, session);
  }
}

export async function screenshot(cdp, session, path) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
}
