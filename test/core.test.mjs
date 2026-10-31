import test from 'node:test';
import assert from 'node:assert/strict';
import { workName, parseArchiveList, checkAssets, MAX_ASSET } from '../scripts/lib.mjs';
import worker from '../worker.mjs';
import { mkdtemp, writeFile, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('stable work identity isolates Chinese names and other archives', () => {
  assert.equal(workName('作品一'), workName('作品一'));
  assert.notEqual(workName('作品一'), workName('作品二'));
  assert.match(workName('A'.repeat(120)), /^[a-z][a-z0-9-]{0,62}$/);
  assert.throws(() => workName('../a\nb'));
});
test('7z listing accepts Chinese media folders and rejects traversal, links and bombs', () => {
  assert.equal(parseArchiveList('Path = 图包/图.png\nSize = 42\nAttributes = A\n\nPath = 视频/1.mp4\nSize = 123\nAttributes = A').length, 2);
  for (const text of ['Path = ../x\nSize = 2', 'Path = C:\\x\nSize = 2', 'Path = /etc/x\nSize = 2', 'Path = x\nSize = 2\nSymbolic Link = /etc', 'Path = x\nSize = 2\nAttributes = A lrwxrwxrwx', `Path = x\nSize = ${11 * 1024 ** 3}`, 'Path = x\nSize = 1\n\nPath = X\nSize = 2']) assert.throws(() => parseArchiveList(text));
});
test('asset checks enforce both per-file and per-worker limits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-limit-'));
  try {
    await writeFile(path.join(dir, 'x'), 'abc');
    assert.deepEqual(await checkAssets(dir), { count: 1, bytes: 3 });
    await assert.rejects(checkAssets(dir, 0), /Asset count/);
    await truncate(path.join(dir, 'x'), MAX_ASSET + 1);
    await assert.rejects(checkAssets(dir), /25 MiB/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('health returns manifest counts; unknown paths delegate without rewriting', async () => {
  const env = { ASSETS: { fetch: async req => new URL(req.url).pathname === '/manifest.json' ? Response.json({ workId: 'one', workerName: workName('one'), items: [{ type: 'image' }, { type: 'video' }] }) : new Response('missing', { status: 404 }) } };
  const res = await worker.fetch(new Request('https://example.org/api/health'), env);
  assert.equal((await res.json()).videos, 1);
  assert.equal((await worker.fetch(new Request('https://example.org/missing'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://example.org/api/health', { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://example.org/api/health', { method: 'HEAD' }), env)).body, null);
});
