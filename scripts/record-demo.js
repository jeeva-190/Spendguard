// Records a captioned demo video of SpendGuard, timed to the voice-over if one exists.
// Usage:  npm run record:demo -- http://localhost:3000
// Needs Google Chrome and ffmpeg. Set CHROME_PATH if Chrome is not found.
// Voice-over: run `python scripts/make-voice.py <model-folder>` first (optional).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URL = process.argv[2] || 'http://localhost:3000/';
const OUT = path.join(__dirname, '..', 'demo-video');
const VOICE = path.join(OUT, 'voice');
const CHROME = process.env.CHROME_PATH || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome');

const LINES = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'narration.json'), 'utf8')).map((l) => [l.id, l]));
const DUR = fs.existsSync(path.join(VOICE, 'durations.json')) ? JSON.parse(fs.readFileSync(path.join(VOICE, 'durations.json'), 'utf8')) : {};
const speechSec = (id) => DUR[id] ?? LINES[id].say.split(/\s+/).length / 2.6;
const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--window-size=1280,720'], headless: 'new' });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await wait(800);

  const overlay = (html, full) => p.evaluate((html, full) => {
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id = '__cap'; document.body.appendChild(el); }
    el.style.cssText = full
      ? 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#11402F;color:#eef1ec;font:800 50px "Schibsted Grotesk",sans-serif;text-align:center;letter-spacing:-.02em;padding:40px;pointer-events:none'
      : 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9999;max-width:1000px;background:rgba(21,33,28,.92);color:#fff;font:600 22px "Schibsted Grotesk",sans-serif;padding:14px 22px;border-radius:16px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none';
    el.innerHTML = html;
    el.style.display = html ? (full ? 'flex' : 'block') : 'none';
  }, html, full);

  // ---- frame capture with real timestamps ----
  fs.rmSync(path.join(OUT, 'frames'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const cdp = await p.createCDPSession();
  const frames = []; let n = 0;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = path.join(OUT, 'frames', `${String(n++).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push([f, metadata.timestamp]);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720 });
  await wait(400);

  // A step = caption + voice line + actions; it lasts at least as long as the voice line.
  const cues = [];
  async function step(id, actions = async () => {}, { full = null, extra = 0 } = {}) {
    const t0 = Date.now();
    cues.push({ id, at: t0 / 1000 });
    console.log('·', LINES[id].show || id);
    if (full) await overlay(full, true); else if (LINES[id].show) await overlay(LINES[id].show, false);
    if (actions) await actions();
    await wait(speechSec(id) * 1000 + 450 + extra - (Date.now() - t0));
  }
  const hideCard = () => p.evaluate(() => { const el = document.getElementById('__cap'); if (el) el.style.display = 'none'; });

  const sub = '<div style="font:500 26px Schibsted Grotesk,sans-serif;margin-top:16px;color:#b9d3c6">';
  await step('title', null, { full: `SpendGuard${sub}An AI that checks every PayPal payment <i>before</i> it leaves your account</div>` });
  await step('problem', null, { full: `Overspent? Most apps tell you after.${sub}SpendGuard steps in before the money goes.</div>` });
  await hideCard();
  await step('sync');
  await step('safe');
  await step('alerts');
  await step('calendar', async () => {
    await p.evaluate(() => window.scrollTo({ top: 560, behavior: 'smooth' })); await wait(900);
    const days = await p.$$('#cal [data-day]'); await days[days.length - 3].click();
  });
  await step('where', async () => { await p.evaluate(() => window.scrollTo({ top: 1250, behavior: 'smooth' })); });
  await step('grid', async () => {
    await p.evaluate(() => window.scrollTo({ top: 0 })); await p.click('.rail [data-go=activity]'); await wait(1600); await p.click('[data-dir=out]');
  });
  await step('fix', async () => {
    await wait(1200); await p.click('.ag-row[row-index="0"] [col-id="category"] button'); await wait(1600);
    await p.click('[data-cat="Bills & Utilities"]');
  });
  await p.click('[data-dir=all]');
  await p.click('.rail [data-go=pay]'); await wait(400);
  const tries = await p.$$('[data-preset]');
  await step('shoes', async () => { await wait(1500); await tries[0].click(); });
  await step('check', async () => { await p.click('#payForm [type=submit]'); });
  await step('stopped', null, { extra: 600 });
  await step('options', async () => { await p.click('.override summary'); await wait(600); await p.type('#overrideReason', 'My old pair is torn', { delay: 55 }); });
  await step('wait', async () => { await wait(400); await p.click('[data-cool]'); }, { extra: 800 });
  await p.click('.ticket [data-close].btn'); await wait(500);
  await step('prize', async () => { await tries[2].click(); await wait(1600); await p.click('#payForm [type=submit]'); });
  await step('hold', null, { extra: 900 });
  await p.click('[data-cancel]'); await wait(700);
  await step('designer', async () => { await tries[1].click(); await wait(500); await p.click('#payForm [type=submit]'); }, { extra: 1200 });
  await step('payout', async () => {
    await p.click('[data-pay]'); await wait(1200);
    await p.evaluate(() => document.querySelector('.apireq pre')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, { extra: 1200 });
  await p.click('.ticket [data-close].btn'); await wait(500);
  await step('history', async () => { await p.evaluate(() => document.getElementById('intents').scrollIntoView({ behavior: 'smooth' })); });
  await step('ask', async () => {
    await p.click('.rail [data-go=ask]'); await wait(700);
    const chips = await p.$$('#chips button'); await chips[2].click(); await wait(2200); await chips[3].click();
  }, { extra: 2500 });
  await step('budgets', async () => { await p.click('.rail [data-go=budgets]'); await wait(900); await p.click('[data-toggle="Food & Dining"]'); }, { extra: 600 });
  await step('settings', async () => { await p.click('.rail [data-go=settings]'); await wait(1500); await p.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' })); });
  await step('private');
  await step('end', null, { full: `SpendGuard${sub}It checks before you spend.<br><br>PayPal Transaction Search + Payouts &nbsp;·&nbsp; AI with tool calling &nbsp;·&nbsp; AG Grid</div>`, extra: 800 });

  // ---- stop and build the video ----
  await wait(300);
  await cdp.send('Page.stopScreencast');
  await b.close();
  const end = Date.now() / 1000;
  const start = frames[0][1];
  let list = '';
  frames.forEach(([f, t], i) => { const next = i + 1 < frames.length ? frames[i + 1][1] : end; list += `file '${f}'\nduration ${Math.max(0.001, next - t).toFixed(3)}\n`; });
  list += `file '${frames[frames.length - 1][0]}'\n`;
  fs.writeFileSync(path.join(OUT, 'frames.txt'), list);
  const silent = path.join(OUT, 'video-silent.mp4');
  const final = path.join(OUT, 'spendguard-demo.mp4');
  const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  try {
    run(['-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', silent]);
    const voiced = cues.filter((c) => fs.existsSync(path.join(VOICE, `${c.id}.wav`)));
    if (voiced.length) {
      const inputs = voiced.flatMap((c) => ['-i', path.join(VOICE, `${c.id}.wav`)]);
      const delays = voiced.map((c, i) => `[${i + 1}:a]adelay=${Math.max(0, Math.round((c.at - start) * 1000 + 150))}:all=1[a${i}]`).join(';');
      const mix = `${delays};${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0,aresample=48000[aout]`;
      run(['-i', silent, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', final]);
    } else {
      fs.copyFileSync(silent, final);
    }
    console.log(`Video saved: ${final}`);
  } catch {
    console.log(`Frames saved in ${OUT}. Install ffmpeg and run this script again.`);
  }
})().catch((e) => { console.error('Recording failed:', e.message); process.exit(1); });
