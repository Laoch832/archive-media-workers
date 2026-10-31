import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.WORKER_URL || process.argv[2];
if (!url || new URL(url).protocol !== 'https:') throw new Error('Provide a Worker HTTPS URL');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${msg.text()} ${msg.location().url}`); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('figure').length > 0);
  const expected = await (await page.request.get(`${url}/api/health`)).json();
  const images = page.locator('figure img');
  const videos = page.locator('figure video');
  if (await images.count() !== expected.images || await videos.count() !== expected.videos) throw new Error('Browser gallery counts differ from health API');
  const imageSamples = Math.min(3, await images.count());
  const videoSamples = Math.min(2, await videos.count());
  for (let i = 0; i < imageSamples; i++) {
    await images.nth(i).scrollIntoViewIfNeeded();
    await images.nth(i).evaluate(img => new Promise((resolve, reject) => {
      if (img.complete) return img.naturalWidth > 0 ? resolve() : reject(new Error('Broken image'));
      img.onload = resolve; img.onerror = () => reject(new Error('Broken image'));
    }));
  }
  const playback = [];
  for (let i = 0; i < videoSamples; i++) {
    const video = videos.nth(i);
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(v => v.play());
    await page.waitForFunction(index => { const v = document.querySelectorAll('video')[index]; return v.currentTime > 1 && v.videoWidth > 0; }, i, { timeout: 45000 });
    playback.push(await video.evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, time: v.currentTime, duration: v.duration })));
    await video.evaluate(v => v.pause());
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  const reportDir = process.env.BROWSER_REPORT_DIR || '.scratch/browser';
  await mkdir(reportDir, { recursive: true });
  await page.screenshot({ path: path.join(reportDir, 'gallery.png') });
  const report = { url, checkedAt: new Date().toISOString(), images: expected.images, videos: expected.videos, imageSamples, videoSamples, playback, consoleErrors: errors };
  await writeFile(path.join(reportDir, 'browser-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
