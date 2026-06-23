export default async function handler(req, res) {
  try { return await mainHandler(req, res); }
  catch (fatalErr) {
    if (!res.headersSent) res.status(500).json({ error: 'Erro inesperado: ' + (fatalErr.message || 'desconhecido') });
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
  if (!profileData?.niche) return res.status(400).json({ error: 'profileData com niche é obrigatório.' });

  const prompt = `Você é um analista de mercado digital especializado em Instagram Brasil. Pesquise na web e encontre os 5 principais concorrentes do perfil @${profileData.username} no nicho "${profileData.niche}" no Brasil.

PERFIL ANALISADO:
- Username: @${profileData.username}
- Nicho: ${profileData.niche}
- Seguidores: ${profileData.followersCount || 'não informado'}
- Bio: ${profileData.biography || 'não informada'}

Pesquise: "melhores perfis instagram ${profileData.niche} brasil 2025", "influenciadores ${profileData.niche} instagram". Identifique 5 contas reais e ativas.

Responda SOMENTE com JSON válido, sem texto antes ou depois:

{
  "concorrentes": [
    {
      "perfil": "@handle_real",
      "seguidores_estimados": "ex: 45k",
      "tipo_conteudo": "<tipo e tema principal, max 12 palavras>",
      "pontos_fortes": ["<ponto 1>", "<ponto 2>"],
      "pontos_fracos": ["<ponto 1>"],
      "diferencial": "<o que os destaca, 1 frase>"
    }
  ],
  "benchmark": {
    "media_engajamento_nicho": "<ex: 2-5%>",
    "formatos_dominantes": ["Reels", "Carrossel"],
    "temas_em_alta": ["<tema 1>", "<tema 2>", "<tema 3>"],
    "frequencia_media_posts": "<ex: 5-7x/semana>"
  },
  "mapa_posicionamento": "<como o nicho está dividido e onde há espaço, 2-3 frases>",
  "oportunidades": ["<oportunidade concreta 1>", "<oportunidade concreta 2>", "<oportunidade concreta 3>"],
  "diferenciais_possiveis": ["<diferencial 1 para @${profileData.username}>", "<diferencial 2>", "<diferencial 3>"]
}

IMPORTANTE: Exatamente 5 concorrentes reais no array. Perfis ativos no Instagram Brasil.`;

  try {
    let messages = [{ role: 'user', content: prompt }];
    let finalText = '';

    for (let round = 0; round < 6; round++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        return res.status(400).json({ error: 'Erro Anthropic (' + response.status + '): ' + errBody.slice(0, 300) });
      }

      const data = await response.json();
      const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
      finalText += textBlocks.join('');

      if (data.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: data.content });
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'user', content: toolUseBlocks.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'ok' })) });
    }

    let raw = finalText.replace(/```json|```/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'IA não retornou JSON válido. Tente novamente.' });
    raw = raw.substring(start, end + 1);

    try {
      return res.status(200).json(JSON.parse(raw));
    } catch {
      return res.status(500).json({ error: 'Resposta malformada. Tente novamente.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Erro na análise de concorrência: ' + (err.message || 'erro desconhecido') });
  }
}
