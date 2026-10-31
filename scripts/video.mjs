import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { run, files, MAX_ASSET } from './lib.mjs';

export async function createHls(file, dir) {
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-of', 'json', file], { capture: true }));
  const stream = probe.streams?.[0];
  if (!stream) throw new Error('Supported video container contains no video stream');
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-fflags', '+genpts', '-i', file,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1'];
  const output = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments', '-hls_segment_filename', path.join(dir, 'segment-%05d.ts'), path.join(dir, 'index.m3u8')];
  if (stream.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && stream.width <= 1920 && stream.height <= 1080) {
    try {
      await run('ffmpeg', [...common, '-c:v', 'copy', ...output]);
      const segments = (await files(dir)).filter(f => f.endsWith('.ts'));
      if (segments.length && (await Promise.all(segments.map(f => stat(f)))).every(s => s.size <= MAX_ASSET)) return 'h264-remux';
    } catch { /* Some containers need full timestamp/codec normalization. */ }
    console.log('Direct HLS packaging requires normalization; using bounded H.264 encoding.');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
  await run('ffmpeg', [...common,
    '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-threads', '2',
    '-force_key_frames', 'expr:gte(t,n_forced*4)', ...output]);
  return 'h264-transcode';
}
