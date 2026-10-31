import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { run, sevenZip, parseArchiveList, workName, files, checkAssets, MAX_ASSET } from './lib.mjs';
import { createHls } from './video.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const at = args.indexOf(`--${name}`); return at < 0 ? fallback : args[at + 1]; };
const workId = arg('id', process.env.WORK_ID);
const name = workName(workId);
const outRoot = path.resolve(arg('output', 'output'));
const output = path.join(outRoot, name);
// Never let an archive control a destination directory, output path, or executable command.
const temp = await mkdtemp(path.join(tmpdir(), 'archive-media-'));
const pass = process.env.ARCHIVE_PASSWORD;
if (!pass) throw new Error('ARCHIVE_PASSWORD is required; use a GitHub Actions secret');
try {
  let archive = arg('archive', process.env.ARCHIVE_PATH);
  const url = process.env.ARCHIVE_URL;
  if (archive && url) throw new Error('Provide exactly one archive path or URL');
  if (url) {
    if (new URL(url).protocol !== 'https:') throw new Error('Archive URL must use HTTPS');
    console.log('Downloading archive over HTTPS (URL and password omitted).');
    archive = path.join(temp, 'source.7z');
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000), redirect: 'error' });
    if (!response.ok) throw new Error(`Archive download failed: HTTP ${response.status}`);
    let received = 0, lastLogged = 0;
    const cap = new Transform({ transform(chunk, _, cb) { received += chunk.length; if (received - lastLogged >= 256 * 1024 ** 2) { console.log(`Downloaded ${Math.floor(received / 1024 ** 2)} MiB`); lastLogged = received; } cb(received > 8 * 1024 ** 3 ? new Error('Download exceeds 8 GiB') : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), cap, createWriteStream(archive));
    console.log(`Download complete: ${received} bytes.`);
  }
  if (!archive) throw new Error('Provide --archive or ARCHIVE_URL');
  archive = path.resolve(archive);
  if ((await stat(archive)).size > 8 * 1024 ** 3) throw new Error('Archive exceeds 8 GiB');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const archiveHash = hash.digest('hex');
  if (process.env.ARCHIVE_SHA256 && process.env.ARCHIVE_SHA256.toLowerCase() !== archiveHash) throw new Error('Archive SHA-256 mismatch');
  const listing = await run(sevenZip(), ['l', '-slt', '-ba', '-sccUTF-8', `-p${pass}`, archive], { capture: true, sensitive: true });
  const entries = parseArchiveList(listing);
  console.log(`Validated ${entries.length} archive entries; extracting encrypted content.`);
  const extracted = path.join(temp, 'extracted');
  await mkdir(extracted);
  await run(sevenZip(), ['x', '-y', '-sccUTF-8', `-p${pass}`, `-o${extracted}`, archive], { sensitive: true });
  const mediaFiles = await files(extracted);
  console.log(`Extraction complete: ${mediaFiles.length} files.`);
  const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tif', '.tiff']);
  const videos = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.flv', '.wmv', '.mpeg', '.mpg']);
  const publicDir = path.join(output, 'public');
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(publicDir, 'media'), { recursive: true });
  const items = [], skipped = [];
  for (const file of mediaFiles) {
    const ext = path.extname(file).toLowerCase();
    const relative = path.relative(extracted, file).split(path.sep).join('/');
    if (!images.has(ext) && !videos.has(ext)) { skipped.push(relative); continue; }
    console.log(`Processing media ${items.length + 1} of ${mediaFiles.length}: ${videos.has(ext) ? 'video' : 'image'}`);
    const digest = createHash('sha256');
    for await (const b of createReadStream(file)) digest.update(b);
    const id = digest.digest('hex').slice(0, 24);
    // Duplicate binary files share storage but remain visible in the work manifest.
    if (images.has(ext)) {
      const dest = path.join(publicDir, 'media', `${id}${ext}`);
      if ((await stat(file)).size <= MAX_ASSET && ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
        await copyFile(file, dest);
        items.push({ type: 'image', title: relative, url: `/media/${id}${ext}` });
      } else {
        const converted = path.join(publicDir, 'media', `${id}.webp`);
        await sharp(file, { limitInputPixels: 268402689 }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(converted);
        items.push({ type: 'image', title: relative, url: `/media/${id}.webp`, converted: true });
      }
    } else {
      const dir = path.join(publicDir, 'media', id);
      await mkdir(dir, { recursive: true });
      const processing = await createHls(file, dir);
      console.log(`Video packaging complete: ${processing}`);
      items.push({ type: 'video', title: relative, url: `/media/${id}/index.m3u8`, processing });
    }
  }
  if (!items.length) throw new Error('Archive contains no supported images or videos');
  const manifest = { schemaVersion: 1, workId, workerName: name, title: process.env.WORK_TITLE || workId, archiveSha256: archiveHash, items };
  await writeFile(path.join(publicDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['index.html', 'gallery.js', 'style.css', '_headers']) await copyFile(path.join(project, 'web', f), path.join(publicDir, f));
  await copyFile(path.join(project, 'node_modules/hls.js/dist/hls.min.js'), path.join(publicDir, 'hls.min.js'));
  await copyFile(path.join(project, 'worker.mjs'), path.join(output, 'worker.mjs'));
  await writeFile(path.join(output, 'wrangler.json'), JSON.stringify({ name, main: './worker.mjs', compatibility_date: '2026-10-01', workers_dev: true, assets: { directory: './public', binding: 'ASSETS', run_worker_first: ['/api/*'] } }, null, 2));
  const assets = await checkAssets(publicDir);
  await writeFile(path.join(output, 'build-report.json'), JSON.stringify({ workId, workerName: name, archiveSha256: archiveHash, images: items.filter(x => x.type === 'image').length, videos: items.filter(x => x.type === 'video').length, skippedFiles: skipped, assets }, null, 2));
  await writeFile(path.join(outRoot, 'current.json'), JSON.stringify({ output, workerName: name }));
  console.log(JSON.stringify({ workerName: name, images: items.filter(x => x.type === 'image').length, videos: items.filter(x => x.type === 'video').length, ...assets }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
