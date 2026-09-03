/**
 * Capture the live interface as 1920x1080 @ 30fps footage for OffthreadVideo.
 *
 * Real interaction against the deployed site — no mock data, no staged screenshots.
 * Run with puppeteer-core installed OUTSIDE this repo so it cannot pollute the
 * workspace dependency graph:
 *   npm install --prefix /tmp/vidtools puppeteer-core@23
 *   NODE_PATH=/tmp/vidtools/node_modules node capture.mjs interface 17
 */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = process.env.SITE_URL ?? "https://yonkoo11.github.io/worstcase/";
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `(() => {
  if (document.getElementById('__c')) return;
  const c = document.createElement('div');
  c.id = '__c';
  c.style.cssText = 'position:fixed;z-index:2147483647;width:20px;height:20px;left:0;top:0;pointer-events:none;transition:transform .5s cubic-bezier(.22,1,.36,1)';
  c.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 1 L2 15 L5.6 11.7 L8 17 L10.6 15.9 L8.2 10.7 L13 10.5 Z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  window.__mv = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  window.__mv(900, 700);
})();`;

const [segment, seconds] = [process.argv[2], Number(process.argv[3] ?? 17)];
const outDir = `frames/${segment}`;
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ["--window-size=1920,1080", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.goto(SITE, { waitUntil: "networkidle2" });
await page.evaluate(CURSOR);
await sleep(900);

const click = async (label) => {
  const box = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().toLowerCase().includes(needle.toLowerCase()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  if (box === null) return false;
  await page.evaluate((x, y) => window.__mv(x, y), box.x, box.y);
  await sleep(700);
  await page.evaluate((needle) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().toLowerCase().includes(needle.toLowerCase()));
    if (el) el.click();
  }, label);
  await sleep(450);
  return true;
};
const point = async (needle) => {
  const box = await page.evaluate((n) => {
    const el = [...document.querySelectorAll("h1,h2,.step,.ruled-row,.figure,.ev,.why")]
      .find((e) => (e.textContent || "").toLowerCase().includes(n.toLowerCase()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 320), y: r.top + r.height / 2 };
  }, needle);
  if (box !== null) await page.evaluate((x, y) => window.__mv(x, y), box.x, box.y);
};

let frame = 0;
let recording = true;
const recorder = (async () => {
  while (recording) {
    const t = Date.now();
    try {
      writeFileSync(`${outDir}/${String(frame++).padStart(5, "0")}.jpg`, await page.screenshot({ type: "jpeg", quality: 88 }));
    } catch { /* busy frame */ }
    await sleep(Math.max(0, 1000 / FPS - (Date.now() - t)));
  }
})();

const script = {
  // Bound -> the responsible call -> the rule -> the ruled-out proof -> policy fix -> zero.
  interface: async () => {
    await sleep(1800);
    await point("Pay Attacker"); await sleep(1700);
    await point("why it is permitted"); await sleep(1900);
    await point("ruled out"); await sleep(2100);
    await click("compare the policy fix"); await sleep(2600);
    await point("no reachable adversarial edge"); await sleep(2000);
    await point("recipient-not-allowed"); await sleep(2400);
  },
  evidence: async () => {
    await sleep(1200);
    await click("evidence"); await sleep(2400);
    await point("0G Storage"); await sleep(2600);
    await point("storage root"); await sleep(2200);
    await point("0G Chain"); await sleep(2600);
    await point("registry"); await sleep(2400);
  },
};
await (script[segment] ?? (async () => { await sleep(seconds * 1000); }))();

recording = false;
await recorder;
await browser.close();
console.log(`${segment}: ${frame} frames`);
