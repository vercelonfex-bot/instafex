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
      safeFetch(`${GRAPH_IG}/${igUserId}/insights?metric=reach,total_interactions&period=day&metric_type=time_series&access_token=${accessToken}`),
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

    const { analysis, analysisError } = await analyzeWithAI({ igUsername, followersCount, accountSeries, posts });

    return res.status(200).json({
      igUsername,
      igUserId,
      followersCount,
      mediaCount,
      accountSeries,
      posts,
      analysis,
      analysis_error: analysisError || null,
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
    const interactionsTotal = (accountSeries.total_interactions || []).reduce((a, v) => a + (v.value || 0), 0);
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

    const prompt = `Você é um estrategista sênior de crescimento no Instagram. Analise os dados reais do perfil @${igUsername}.

DADOS REAIS DO PERFIL:
- Seguidores totais: ${followersCount != null ? followersCount.toLocaleString('pt-BR') : 'N/A'}
- Alcance total no período: ${reachTotal.toLocaleString('pt-BR')}
- Interações totais no período: ${interactionsTotal.toLocaleString('pt-BR')}
- Posts analisados: ${posts.length}
- Taxa de engajamento média: ${engRate ? engRate + '%' : 'N/A'} (curtidas+comentários / seguidores)
- Média de impressões por post: ${avgImpressions.toLocaleString('pt-BR')}
- Total curtidas: ${totalLikes} | Comentários: ${totalComments} | Salvamentos: ${totalSaved}
- Tipos de conteúdo: ${Object.entries(typeCount).map(([t, c]) => `${t}(${c})`).join(', ')}

TOP 3 POSTS (por impressões):
${topPosts.map((p, i) => `${i + 1}. [${p.mediaType}] "${(p.caption?.slice(0, 80) || 'sem legenda').replace(/"/g, "'")}" - impressoes:${p.impressions || p.reach || 0} curtidas:${p.likeCount} comentarios:${p.commentsCount} salvamentos:${p.saved || 0}`).join('\n')}

Classifique o engajamento como: Baixo (<1%), Medio (1-3%), Alto (3-6%), Excelente (>6%).
Seja especifico com os dados reais, escreva em portugues brasileiro, seja direto e pratico.`;

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
        tools: [{
          name: 'instagram_analysis',
          description: 'Retorna análise estratégica estruturada do perfil Instagram',
          input_schema: {
            type: 'object',
            properties: {
              audiencia: {
                type: 'object',
                properties: {
                  resumo: { type: 'string', description: '2-3 frases sobre comportamento da audiência' },
                  insights: { type: 'array', items: { type: 'string' }, description: '3 insights específicos sobre a audiência' }
                },
                required: ['resumo', 'insights']
              },
              engajamento: {
                type: 'object',
                properties: {
                  taxa: { type: 'string', description: 'Taxa de engajamento como string ex: 0.54%' },
                  classificacao: { type: 'string', enum: ['Baixo', 'Médio', 'Alto', 'Excelente'] },
                  resumo: { type: 'string', description: '2-3 frases avaliando alcance e engajamento' },
                  insights: { type: 'array', items: { type: 'string' }, description: '3 insights sobre engajamento e alcance' }
                },
                required: ['taxa', 'classificacao', 'resumo', 'insights']
              },
              oportunidades: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    descricao: { type: 'string', description: 'Ação concreta de 1-2 frases' }
                  },
                  required: ['titulo', 'descricao']
                },
                description: '4 oportunidades de crescimento concretas e acionáveis'
              }
            },
            required: ['audiencia', 'engajamento', 'oportunidades']
          }
        }],
        tool_choice: { type: 'tool', name: 'instagram_analysis' },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const result = await response.json();
    if (result.error) return { analysis: null, analysisError: `Anthropic: ${result.error.message}` };
    const toolUse = result.content?.find(b => b.type === 'tool_use');
    if (!toolUse) return { analysis: null, analysisError: 'Sem resposta de tool use do Claude' };
    return { analysis: toolUse.input, analysisError: null };
  } catch (e) {
    return { analysis: null, analysisError: e.message || 'Erro desconhecido na análise IA' };
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
