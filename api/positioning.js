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

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY não configurado.' });

  const { profileData } = req.body || {};
  if (!profileData) return res.status(400).json({ error: 'profileData obrigatório.' });

  const posts = (profileData.postsDetailed || []).slice(0, 10);
  const postsSummary = posts.length > 0
    ? posts.map((p, i) => `${i + 1}. [${p.type}] "${(p.caption || '').slice(0, 150)}" (${p.likesCount} likes, ${p.commentsCount} comentários)`).join('\n')
    : 'Nenhuma publicação recente disponível.';

  const prompt = `Você é um analista de marca e comunicação digital. Com base SOMENTE nos dados abaixo (não invente números, não pesquise nada), produza um diagnóstico objetivo de posicionamento e comunicação de um perfil de Instagram.

DADOS DO PERFIL:
- Username: @${profileData.username}
- Nome: ${profileData.fullName || 'não informado'}
- Bio: "${profileData.biography || 'não informada'}"
- Categoria de negócio (se informada pelo Instagram): ${profileData.businessCategoryName || 'não informada'}
- Link na bio: ${profileData.externalUrl ? 'sim — ' + profileData.externalUrl : 'não possui'}
- Seguidores: ${profileData.followersCount || 0} | Seguindo: ${profileData.followingCount || 0} | Posts: ${profileData.postsCount || 0}
- Verificado: ${profileData.isVerified ? 'sim' : 'não'}
- Destaques (highlights): ${profileData.highlightCount || 0}
- Cadência média de publicação: ${profileData.cadenceDays ? profileData.cadenceDays + ' dias entre posts' : 'não foi possível calcular'}
- Hashtags mais recorrentes: ${(profileData.topHashtags || []).join(', ') || 'nenhuma identificada'}

ÚLTIMAS PUBLICAÇÕES (legendas resumidas):
${postsSummary}

Responda SOMENTE com um bloco JSON válido, sem texto antes ou depois:
{
  "tom_de_voz": "<descrição objetiva do tom de voz percebido nas legendas e bio, 1 frase>",
  "mensagem_central": "<qual é a mensagem/promessa central que o perfil comunica, 1-2 frases>",
  "publico_aparente": "<para quem esse conteúdo parece estar falando, com base no tom e temas, 1 frase>",
  "consistencia_visual_texto": "<avaliação textual da consistência entre os posts — temas repetidos, variedade de formatos, 1-2 frases>",
  "presenca_digital": "<avaliação da presença digital: uso de bio, link, destaques, frequência de postagem, 1-2 frases>",
  "observacoes": ["<observação objetiva 1>", "<observação objetiva 2>", "<observação objetiva 3>"]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(400).json({ error: 'Erro Anthropic (' + response.status + '): ' + errBody.slice(0, 300) });
    }

    const data = await response.json();
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    let raw = textBlocks.join('').replace(/```json|```/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'A IA não retornou um JSON válido. Tente novamente.' });
    }
    raw = raw.substring(start, end + 1);

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Resposta da IA veio malformada. Tente novamente.' });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar posicionamento: ' + (err.message || 'erro desconhecido') });
  }
}
