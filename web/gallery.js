async function main() {
  const response = await fetch('/manifest.json');
  if (!response.ok) throw new Error('作品清单加载失败');
  const manifest = await response.json();
  document.title = manifest.title;
  document.querySelector('#title').textContent = manifest.title;
  const nImages = manifest.items.filter(x => x.type === 'image').length;
  document.querySelector('#summary').textContent = `${nImages} 张图片 · ${manifest.items.length - nImages} 个视频`;
  for (const item of manifest.items) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = item.title;
    if (item.type === 'image') {
      const a = document.createElement('a'); a.href = item.url; a.target = '_blank'; a.rel = 'noopener';
      const img = document.createElement('img'); img.src = item.url; img.alt = item.title; img.loading = 'lazy';
      a.append(img); figure.append(a);
    } else {
      const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.preload = 'none'; video.setAttribute('aria-label', item.title);
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = item.url;
      else if (window.Hls?.isSupported()) {
        const hls = new Hls({ autoStartLoad: false }); hls.loadSource(item.url); hls.attachMedia(video);
        video.addEventListener('play', () => hls.startLoad(), { once: true });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { caption.textContent = `${item.title}（播放失败，请刷新重试）`; hls.destroy(); } });
      } else caption.textContent += '（当前浏览器不支持 HLS）';
      figure.append(video);
    }
    figure.append(caption); document.querySelector('#gallery').append(figure);
  }
}
main().catch(error => { document.querySelector('#summary').textContent = error.message; });
