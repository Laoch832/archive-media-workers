export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      const manifest = await env.ASSETS.fetch(new Request(new URL('/manifest.json', url), { method: 'GET' }));
      if (!manifest.ok) return Response.json({ ok: false }, { status: 503 });
      const data = await manifest.json();
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true, workId: data.workId, workerName: data.workerName, images: data.items.filter(x => x.type === 'image').length, videos: data.items.filter(x => x.type === 'video').length }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  }
};
