import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, sevenZip } from './lib.mjs';

// Synthetic fixtures only. This password never protects real content.
const root = path.resolve('.scratch/demo');
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, '图包'), { recursive: true });
await mkdir(path.join(root, '视频'), { recursive: true });
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2463eb:s=640x360', '-frames:v', '1', path.join(root, '图包/图片 01.png')]);
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '9', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*4)', '-c:a', 'aac', '-shortest', path.join(root, '视频/视频 01.mp4')]);
await writeFile(path.join(root, '说明.txt'), 'Synthetic media fixture; ignore non-media files.');
await mkdir('input', { recursive: true });
await rm('input/demo.7z', { force: true });
await run(sevenZip(), ['a', '-t7z', '-mhe=on', '-pdemo-only-2026', path.resolve('input/demo.7z'), '.'], { cwd: root, sensitive: true });
console.log('Created input/demo.7z: header-encrypted archive with Chinese image/video directories');
