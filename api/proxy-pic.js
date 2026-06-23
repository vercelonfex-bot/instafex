export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).end();
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const decoded = decodeURIComponent(String(url));
    const r = await fetch(decoded, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.instagram.com/'
      }
    });
    if (!r.ok) return res.status(r.status).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).end(buf);
  } catch {
    return res.status(500).end();
  }
}
