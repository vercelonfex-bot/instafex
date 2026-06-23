// api/insights.js
// Usa o token salvo na sessão (cookie) para buscar métricas internas reais —
// só funciona depois que o usuário passou pelo login oficial em /api/auth/start.
//
// Host correto pro fluxo "Instagram API with Instagram Login": graph.instagram.com
// (diferente do fluxo antigo via Facebook Login, que usava graph.facebook.com).

import { getSession } from '../lib/session.js';

const GRAPH_IG = 'https://graph.instagram.com/v21.0';

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
    // Métricas de conta: reach e follower_count são as mais estáveis hoje.
    // Se a Meta mudar nomes de novo, ajuste aqui conforme a doc oficial:
    // https://developers.facebook.com/docs/instagram-platform/insights/
    //
    // As duas chamadas abaixo são independentes — rodam em paralelo (Promise.all)
    // pra resposta sair em metade do tempo.
    const [accountMetrics, mediaRes] = await Promise.all([
      safeFetch(`${GRAPH_IG}/${igUserId}/insights?metric=reach,follower_count&period=day&metric_type=time_series&access_token=${accessToken}`),
      safeFetch(`${GRAPH_IG}/${igUserId}/media?fields=id,caption,media_type,timestamp,permalink,like_count,comments_count,insights.metric(impressions,reach,saved)&limit=12&access_token=${accessToken}`)
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
        likeCount: m.like_count || 0,
        commentsCount: m.comments_count || 0,
        reach: ins.reach ?? null,
        saved: ins.saved ?? null
      };
    });

    const accountSeries = (accountMetrics?.data || []).reduce((acc, metric) => {
      acc[metric.name] = (metric.values || []).map(v => ({ date: v.end_time, value: v.value }));
      return acc;
    }, {});

    return res.status(200).json({
      igUsername,
      igUserId,
      accountSeries,
      posts,
      account_metrics_warning: accountMetrics?.error ? accountMetrics.error.message : null,
      media_warning: mediaRes?.error ? mediaRes.error.message : null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar Insights: ' + (err.message || 'desconhecido') });
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
