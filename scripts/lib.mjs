import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_ASSET = 25 * 1024 * 1024;
export const sha = data => createHash('sha256').update(data).digest('hex');
export const sevenZip = () => process.env.SEVEN_ZIP || (process.platform === 'win32' ? '7z.exe' : '7z');
export function workName(id) {
  if (!id || id.length > 120 || /[\r\n\0]/.test(id)) throw new Error('work_id must contain 1–120 characters without line breaks');
  const slug = id.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'media';
  return `work-${slug}-${sha(id).slice(0, 10)}`;
}
export async function run(command, args, { cwd, capture = false, sensitive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; if (stdout.length > 16_000_000) child.kill(); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-16_000); });
    child.on('error', () => reject(new Error(`Cannot start ${path.basename(command)}; install the required tool`)));
    child.on('close', code => code === 0 ? resolve(capture ? stdout : undefined) : reject(new Error(
      sensitive ? `${path.basename(command)} failed (exit ${code}); check archive password, format and integrity` : `${path.basename(command)} failed (${code}): ${stderr.slice(-3000)}`)));
  });
}
export function parseArchiveList(text) {
  const entries = text.trim().split(/\r?\n\r?\n/).filter(Boolean).map(block => Object.fromEntries(
    block.split(/\r?\n/).map(line => { const at = line.indexOf(' = '); return at < 0 ? null : [line.slice(0, at), line.slice(at + 3)]; }).filter(Boolean)));
  const seen = new Set();
  let size = 0;
  for (const e of entries) {
    const name = e.Path?.replaceAll('\\', '/');
    if (!name || /[\0-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some(x => x === '..' || x === '.')) throw new Error('Unsafe archive path');
    if (e['Symbolic Link'] || e['Hard Link'] || /(^|\s)l[rwx-]{9}/.test(e.Attributes || '') || e['Anti'] === '+') throw new Error('Archive links and anti-items are forbidden');
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate archive paths');
    seen.add(name.toLowerCase());
    const n = Number(e.Size || 0);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid unpacked size');
    size += n;
  }
  if (!entries.length) throw new Error('Empty archive');
  if (entries.length > 50000 || size > 10 * 1024 ** 3) throw new Error('Archive exceeds 50,000 entries or 10 GiB unpacked');
  return entries;
}
export async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) throw new Error('Extracted archive contains a symbolic link');
    if (info.isDirectory()) result.push(...await files(full));
    else if (info.isFile()) result.push(full);
    else throw new Error('Unsupported filesystem entry');
  }
  return result.sort();
}
export async function checkAssets(root, maxFiles = 20000) {
  const all = await files(root);
  if (all.length > maxFiles) throw new Error(`Asset count ${all.length} exceeds ${maxFiles}; this work needs a higher plan or fewer assets`);
  let bytes = 0;
  for (const f of all) {
    const n = (await lstat(f)).size;
    if (n > MAX_ASSET) throw new Error(`Asset exceeds Cloudflare 25 MiB limit: ${path.basename(f)}`);
    bytes += n;
  }
  return { count: all.length, bytes };
}
export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
