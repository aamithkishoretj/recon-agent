import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const origin = 'http://127.0.0.1:5173';
const output = join(root, 'demo-evidence', new Date().toISOString().replaceAll(':', '').replaceAll('.', '-'));
const screenshots = join(output, 'screenshots');
const browserProfile = mkdtempSync(join(tmpdir(), 'recon-evidence-'));
mkdirSync(screenshots, { recursive: true });

if (!existsSync(edge)) throw new Error('Microsoft Edge was not found at the expected local path.');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForFile(path, timeout = 12_000) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > timeout) throw new Error('Timed out starting the screenshot browser.');
    await delay(100);
  }
}

class CDP {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error('Could not connect to the screenshot browser.'));
    });
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }

  async call(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
}

async function waitForExpression(cdp, expression, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const response = await cdp.call('Runtime.evaluate', { expression, returnByValue: true });
    if (response.result?.value) return;
    await delay(120);
  }
  throw new Error('Timed out waiting for the page: ' + expression);
}

async function evaluate(cdp, expression) {
  return cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
}

async function navigate(cdp, hash, readySelector) {
  await cdp.call('Page.navigate', { url: origin + '/' + hash });
  await waitForExpression(cdp, `document.readyState === 'complete'`);
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`);
  await delay(450);
}

async function screenshot(cdp, name) {
  const capture = await cdp.call('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  writeFileSync(join(screenshots, name), Buffer.from(capture.data, 'base64'));
}

async function elementScreenshot(cdp, name, selector) {
  const response = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); const rect = element.getBoundingClientRect(); return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height }; })()`);
  const box = response.result.value;
  const capture = await cdp.call('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
  });
  writeFileSync(join(screenshots, name), Buffer.from(capture.data, 'base64'));
}

function activeShowcaseFolder(serverManifest) {
  const rootDir = join(root, 'backend', 'showcase-runs');
  const folders = readdirSync(rootDir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort().reverse();
  for (const folder of folders) {
    const path = join(rootDir, folder, 'demo_cases.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.cases?.[0]?.entity_id === serverManifest.cases?.[0]?.entity_id) return join(rootDir, folder);
  }
  throw new Error('Could not pair the active localhost dataset with its verified report.');
}

let browser;
try {
  const manifestResponse = await fetch('http://127.0.0.1:8000/demo-cases');
  if (!manifestResponse.ok) throw new Error('The local API is not responding. Start npm.cmd run showcase first.');
  const serverManifest = await manifestResponse.json();
  if (!serverManifest.available || serverManifest.cases?.length !== 5) {
    throw new Error('Localhost is not running the verified five-case showcase.');
  }
  const runFolder = activeShowcaseFolder(serverManifest);

  browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${browserProfile}`, '--window-size=1440,1050', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  const portFile = join(browserProfile, 'DevToolsActivePort');
  await waitForFile(portFile);
  const [port] = readFileSync(portFile, 'utf8').split(/\r?\n/);
  let targets = [];
  for (let attempt = 0; attempt < 50 && !targets.length; attempt++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await delay(100); }
  }
  const target = targets.find(item => item.type === 'page');
  if (!target) throw new Error('The screenshot browser did not create a page target.');

  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });

  await navigate(cdp, '#dashboard', '.showcase-card');
  await screenshot(cdp, '01-overview.png');

  await evaluate(cdp, `document.querySelector('.showcase-section').scrollIntoView({block:'start'}); true`);
  await delay(250);
  await screenshot(cdp, '02-five-showcase-cases.png');

  const caseNames = ['fee-gst', 'batched-payout', 'partial-refund', 't-plus-2', 'unexplained-shortfall'];
  for (let index = 0; index < caseNames.length; index++) {
    await evaluate(cdp, `document.querySelectorAll('.showcase-card')[${index}].click(); true`);
    await waitForExpression(cdp, `Boolean(document.querySelector('dialog[open]'))`);
    await delay(250);
    await screenshot(cdp, `${String(index + 3).padStart(2, '0')}-case-${caseNames[index]}.png`);
    await evaluate(cdp, `document.querySelector('button[aria-label="Close dialog"]').click(); true`);
    await waitForExpression(cdp, `!document.querySelector('dialog[open]')`);
  }

  await waitForExpression(cdp, `Boolean(document.querySelector('.evaluation-results'))`);
  await delay(250);
  await elementScreenshot(cdp, '08-record-level-accuracy.png', '.dataset-checks');

  await navigate(cdp, '#exceptions', '.workbench-panel');
  await screenshot(cdp, '09-review-queue.png');
  await navigate(cdp, '#auditlog', '.audit-workspace');
  await screenshot(cdp, '10-audit-trail.png');
  await navigate(cdp, '#imports', '.ingestion-workspace');
  await screenshot(cdp, '11-new-run.png');

  copyFileSync(join(runFolder, 'report.json'), join(output, 'verified-report.json'));
  copyFileSync(join(runFolder, 'demo_cases.json'), join(output, 'showcase-manifest.json'));
  copyFileSync(join(root, 'DEMO.md'), join(output, 'PRESENTATION_NOTES.md'));
  const summary = {
    captured_at: new Date().toISOString(),
    source_run: runFolder,
    local_url: origin + '/#dashboard',
    screenshots: readdirSync(screenshots).sort(),
    verification: JSON.parse(readFileSync(join(runFolder, 'report.json'), 'utf8')).evaluation,
  };
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(output, 'README.txt'), [
    'ReconAgent buildathon fallback evidence',
    '',
    'Open screenshots/01-overview.png first, then 02-five-showcase-cases.png.',
    'Screenshots 03–07 show the real evidence dialog for each canonical case.',
    'Screenshots 08–11 cover measured accuracy, review, audit, and new-run flows.',
    'verified-report.json is the exact evaluator report for this captured dataset.',
    'PRESENTATION_NOTES.md contains the three-minute walkthrough.',
  ].join('\r\n'));

  await cdp.call('Browser.close').catch(() => {});
  console.log(JSON.stringify({ output, screenshots: summary.screenshots.length, runFolder }));
} finally {
  if (browser && browser.exitCode === null) browser.kill();
  await delay(500);
  try { rmSync(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
  catch { console.warn('Temporary browser profile will be cleaned up by Windows.'); }
}
