export default async function handler(req, res) {
  try {
    return await mainHandler(req, res);
  } catch (fatalErr) {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erro inesperado no servidor: ' + (fatalErr.message || 'desconhecido') });
    }
  }
}

async function mainHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username } = req.body || {};
  const token = process.env.APIFY_TOKEN;

  if (!token) return res.status(500).json({ error: 'APIFY_TOKEN não configurado nas variáveis de ambiente da Vercel.' });
  if (!username) return res.status(400).json({ error: 'Username obrigatório.' });

  const handle = username.replace('@', '').trim();

  try {
    // 1. Start actor run
    const startRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [handle], resultsLimit: 12 })
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      return res.status(400).json({ error: 'Falha ao iniciar Apify: ' + err });
    }

    const startData = await startRes.json();
    const runId = startData.data.id;

    // 2. Poll until done (max 90s — agora com Fluid Compute há margem suficiente dentro dos 280s)
    let status = 'RUNNING';
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
      const pollData = await pollRes.json();
      status = pollData.data.status;
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'ABORTED') {
        return res.status(400).json({ error: 'Apify falhou. Perfil pode ser privado ou inexistente.' });
      }
    }

    if (status !== 'SUCCEEDED') {
      return res.status(408).json({ error: 'Timeout: o Apify demorou demais. Tente novamente.' });
    }

    // 3. Fetch results
    const dataRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}`);
    const items = await dataRes.json();

    if (!items || items.length === 0) {
      return res.status(404).json({ error: 'Perfil não encontrado. Verifique se é público.' });
    }

    const profile = items[0];

    // Validação: garante que vieram dados reais e não um objeto vazio/inválido
    if (!profile.username) {
      return res.status(404).json({ error: 'Dados do perfil inválidos ou incompletos retornados pelo Apify.' });
    }

    // 4. Build clean response
    const latestPosts = profile.latestPosts || [];
    const avgLikes = latestPosts.length > 0
      ? Math.round(latestPosts.reduce((a, p) => a + (p.likesCount || 0), 0) / latestPosts.length)
      : 0;
    const avgComments = latestPosts.length > 0
      ? Math.round(latestPosts.reduce((a, p) => a + (p.commentsCount || 0), 0) / latestPosts.length)
      : 0;

    // Publicações detalhadas — usadas na Etapa 1 para análise de comunicação/posicionamento
    const postsDetailed = latestPosts.slice(0, 12).map(p => ({
      type: p.type || p.productType || 'Post',
      caption: (p.caption || '').slice(0, 280),
      likesCount: p.likesCount || 0,
      commentsCount: p.commentsCount || 0,
      timestamp: p.timestamp || null,
      hashtags: p.hashtags || [],
      thumbnailUrl: p.displayUrl || p.thumbnailUrl || ''
    }));

    // Cadência de publicação: média de dias entre posts, calculada pelos timestamps disponíveis
    let cadenceDays = null;
    const timestamps = postsDetailed
      .map(p => p.timestamp ? new Date(p.timestamp).getTime() : null)
      .filter(Boolean)
      .sort((a, b) => b - a);
    if (timestamps.length >= 2) {
      const diffs = [];
      for (let i = 0; i < timestamps.length - 1; i++) diffs.push((timestamps[i] - timestamps[i + 1]) / 86400000);
      cadenceDays = Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
    }

    // Hashtags mais usadas (presença/posicionamento de conteúdo)
    const hashtagCount = {};
    postsDetailed.forEach(p => (p.hashtags || []).forEach(h => { hashtagCount[h] = (hashtagCount[h] || 0) + 1; }));
    const topHashtags = Object.entries(hashtagCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);

    return res.status(200).json({
      username: profile.username,
      fullName: profile.fullName || '',
      biography: profile.biography || '',
      followersCount: profile.followersCount || 0,
      followingCount: profile.followingCount || 0,
      postsCount: profile.postsCount || 0,
      isVerified: profile.verified || false,
      externalUrl: profile.externalUrl || '',
      businessCategoryName: profile.businessCategoryName || '',
      highlightCount: profile.highlightReelCount || 0,
      avgLikes,
      avgComments,
      recentPostsCount: latestPosts.length,
      profilePicUrl: profile.profilePicUrl || '',
      postsDetailed,
      cadenceDays,
      topHashtags
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
