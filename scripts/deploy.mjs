import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { run, readJson, sha } from './lib.mjs';

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Missing Cloudflare secrets; run the authorized deployment bridge or configure secrets in this repository');
const current = await readJson('output/current.json');
const project = path.resolve('node_modules/wrangler/bin/wrangler.js');
const log = await run(process.execPath, [project, 'deploy', '--config', path.join(current.output, 'wrangler.json')], { capture: true });
// Print deploy output only: Wrangler masks authentication; archive passwords are never sent to Wrangler.
console.log(log);
const url = log.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/)?.[0];
if (!url) throw new Error('Wrangler returned no workers.dev URL');
const localRoot = path.join(current.output, 'public');
const localManifest = await readJson(path.join(localRoot, 'manifest.json'));
const report = { url, workerName: current.workerName, checkedAt: new Date().toISOString(), checks: [] };
async function get(asset) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(url + asset, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === 11) throw new Error(`Live verification failed for ${asset}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
const health = await (await get('/api/health')).json();
if (!health.ok || health.workerName !== current.workerName) throw new Error('Live health belongs to another work');
report.checks.push('health');
const remoteManifest = new Uint8Array(await (await get('/manifest.json')).arrayBuffer());
if (sha(remoteManifest) !== sha(await readFile(path.join(localRoot, 'manifest.json')))) throw new Error('Remote manifest differs from build');
report.checks.push('manifest-sha256');
for (const item of localManifest.items) {
  const bytes = new Uint8Array(await (await get(item.url)).arrayBuffer());
  if (sha(bytes) !== sha(await readFile(path.join(localRoot, item.url.slice(1))))) throw new Error('Remote media differs from build');
  report.checks.push(`${item.type}-sha256`);
  if (item.type === 'video') {
    const refs = new TextDecoder().decode(bytes).split(/\r?\n/).filter(x => x && !x.startsWith('#'));
    for (const ref of refs) {
      const segment = path.posix.join(path.posix.dirname(item.url), ref);
      const remote = new Uint8Array(await (await get(segment)).arrayBuffer());
      if (sha(remote) !== sha(await readFile(path.join(localRoot, segment.slice(1))))) throw new Error('Remote HLS segment differs from build');
    }
    console.log(`Verified ${refs.length} online HLS segments; decoding live video.`);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-i', url + item.url, '-f', 'null', '-']);
    report.checks.push('live-hls-decode');
  }
}
for (const asset of ['/', '/gallery.js', '/hls.min.js', '/style.css']) await get(asset);
report.checks.push('gallery-assets');
await writeFile(path.join(current.output, 'live-verification.json'), JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Published work\n\n[${current.workerName}](${url})\n\nImages: ${health.images}; videos: ${health.videos}. SHA-256 of every media asset and segment matched; all HLS videos decoded from the live URL.\n`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `url=${url}\nworker_name=${current.workerName}\n`);
console.log(JSON.stringify(report));
