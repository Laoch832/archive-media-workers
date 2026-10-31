import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { checkAssets, readJson, run, sha } from './lib.mjs';

const current = await readJson('output/current.json');
const root = path.join(current.output, 'public');
const manifest = await readJson(path.join(root, 'manifest.json'));
const evidence = { workerName: current.workerName, images: 0, videos: 0, segments: 0, decodedVideos: 0, assets: await checkAssets(root) };
for (const item of manifest.items) {
  if (!/^\/media\/[a-f0-9]{24}(?:\.[a-z]+|\/index\.m3u8)$/.test(item.url)) throw new Error('Unsafe manifest URL');
  const local = path.join(root, item.url.slice(1));
  if (!(await stat(local)).size) throw new Error('Empty media file');
  if (item.type === 'image') { evidence.images++; continue; }
  evidence.videos++;
  const playlist = await readFile(local, 'utf8');
  if (!playlist.includes('#EXT-X-ENDLIST')) throw new Error('HLS must be a complete VOD playlist');
  const segments = playlist.split(/\r?\n/).filter(x => x && !x.startsWith('#'));
  if (!segments.length) throw new Error('Missing HLS segments');
  for (const segment of segments) {
    if (!/^segment-\d+\.ts$/.test(segment)) throw new Error('Unsafe HLS segment path');
    if (!(await stat(path.join(path.dirname(local), segment))).size) throw new Error('Empty HLS segment');
  }
  evidence.segments += segments.length;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', local, '-f', 'null', '-']);
  evidence.decodedVideos++;
}
evidence.manifestSha256 = sha(await readFile(path.join(root, 'manifest.json')));
await writeFile(path.join(current.output, 'verification.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
