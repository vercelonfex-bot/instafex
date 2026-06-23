import { getSession } from '../lib/session.js';

const GRAPH_IG = 'https://graph.instagram.com/v21.0';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = getSession(req);
  if (!session || !session.accessToken) {
    return res.status(401).json({ error: 'Conta não conectada. Faça login com o Instagram primeiro.' });
  }

  const { accessToken, igUserId, igUsername } = session;

  try {
    const [accountMetrics, mediaRes, meRes] = await Promise.all([
      safeFetch(`${GRAPH_IG}/${igUserId}/insights?metric=reach,impressions&period=day&metric_type=time_series&access_token=${accessToken}`),
      safeFetch(`${GRAPH_IG}/${igUserId}/media?fields=id,caption,media_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url,insights.metric(impressions,reach,saved)&limit=12&access_token=${accessToken}`),
      safeFetch(`${GRAPH_IG}/${igUserId}?fields=followers_count,media_count&access_token=${accessToken}`)
    ]);

    const posts = (mediaRes?.data || []).map(m => {
      const ins = (m.insights?.data || []).reduce((acc, i) => {
        acc[i.name] = i.values?.[0]?.value ?? null;
        return acc;
      }, {});
      return {
        id: m.id,
        caption: (m.caption || '').slice(0, 200),
        mediaType: m.media_type,
        timestamp: m.timestamp,
        permalink: m.permalink,
        thumbnailUrl: m.thumbnail_url || m.media_url || null,
        likeCount: m.like_count || 0,
        commentsCount: m.comments_count || 0,
        impressions: ins.impressions ?? null,
        reach: ins.reach ?? null,
        saved: ins.saved ?? null
      };
    });

    const accountSeries = (accountMetrics?.data || []).reduce((acc, metric) => {
      acc[metric.name] = (metric.values || []).map(v => ({ date: v.end_time, value: v.value }));
      return acc;
    }, {});

    const followersCount = meRes?.followers_count ?? null;
    const mediaCount = meRes?.media_count ?? null;

    const analysis = await analyzeWithAI({ igUsername, followersCount, accountSeries, posts });

    return res.status(200).json({
      igUsername,
      igUserId,
      followersCount,
      mediaCount,
      accountSeries,
      posts,
      analysis,
      account_metrics_warning: accountMetrics?.error ? accountMetrics.error.message : null,
      media_warning: mediaRes?.error ? mediaRes.error.message : null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar Insights: ' + (err.message || 'desconhecido') });
  }
}

async function analyzeWithAI({ igUsername, followersCount, accountSeries, posts }) {
  try {
    const reachTotal = (accountSeries.reach || []).reduce((a, v) => a + (v.value || 0), 0);
    const impressionsTotal = (accountSeries.impressions || []).reduce((a, v) => a + (v.value || 0), 0);
    const totalLikes = posts.reduce((a, p) => a + p.likeCount, 0);
    const totalComments = posts.reduce((a, p) => a + p.commentsCount, 0);
    const totalSaved = posts.reduce((a, p) => a + (p.saved || 0), 0);
    const avgImpressions = posts.length > 0
      ? Math.round(posts.reduce((a, p) => a + (p.impressions || p.reach || 0), 0) / posts.length)
      : 0;
    const engRate = followersCount > 0 && posts.length > 0
      ? ((totalLikes + totalComments) / posts.length / followersCount * 100).toFixed(2)
      : null;

    const typeCount = posts.reduce((acc, p) => { acc[p.mediaType] = (acc[p.mediaType] || 0) + 1; return acc; }, {});
    const topPosts = [...posts]
      .sort((a, b) => (b.impressions || b.reach || 0) - (a.impressions || a.reach || 0))
      .slice(0, 3);

    const prompt = `Você é um estrategista sênior de crescimento no Instagram. Analise os dados reais do perfil @${igUsername} e retorne SOMENTE um JSON válido, sem texto adicional antes ou depois.

DADOS REAIS DO PERFIL:
- Seguidores totais: ${followersCount != null ? followersCount.toLocaleString('pt-BR') : 'N/A'}
- Alcance total no período: ${reachTotal.toLocaleString('pt-BR')}
- Impressões totais: ${impressionsTotal.toLocaleString('pt-BR')}
- Posts analisados: ${posts.length}
- Taxa de engajamento média: ${engRate ? engRate + '%' : 'N/A'} (curtidas+comentários / seguidores)
- Média de impressões por post: ${avgImpressions.toLocaleString('pt-BR')}
- Total curtidas: ${totalLikes} | Comentários: ${totalComments} | Salvamentos: ${totalSaved}
- Tipos de conteúdo: ${Object.entries(typeCount).map(([t, c]) => `${t}(${c})`).join(', ')}

TOP 3 POSTS (por impressões):
${topPosts.map((p, i) => `${i + 1}. [${p.mediaType}] "${p.caption?.slice(0, 80) || 'sem legenda'}" → 👁${p.impressions || p.reach || 0} ♥${p.likeCount} 💬${p.commentsCount} 🔖${p.saved || 0}`).join('\n')}

Retorne APENAS este JSON:
{
  "audiencia": {
    "resumo": "2-3 frases analisando comportamento da audiência com base nos dados reais",
    "insights": ["insight específico 1", "insight específico 2", "insight específico 3"]
  },
  "engajamento": {
    "taxa": "${engRate || 'N/A'}%",
    "classificacao": "Baixo",
    "resumo": "2-3 frases avaliando alcance, engajamento e potencial de conversão com base nos dados reais",
    "insights": ["insight 1", "insight 2", "insight 3"]
  },
  "oportunidades": [
    {"titulo": "Oportunidade 1", "descricao": "ação concreta e específica de 1-2 frases"},
    {"titulo": "Oportunidade 2", "descricao": "ação concreta e específica de 1-2 frases"},
    {"titulo": "Oportunidade 3", "descricao": "ação concreta e específica de 1-2 frases"},
    {"titulo": "Oportunidade 4", "descricao": "ação concreta e específica de 1-2 frases"}
  ]
}

A classificação do engajamento deve ser: "Baixo" se < 1%, "Médio" se 1-3%, "Alto" se 3-6%, "Excelente" se > 6%.
Seja específico com os dados reais, fale em português brasileiro, seja direto e prático.`;

    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

async function safeFetch(url) {
  try {
    const r = await fetch(url);
    return await r.json();
  } catch (err) {
    return { error: { message: err.message } };
  }
}
