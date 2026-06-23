export default async function handler(req, res) {
  try {
    return await mainHandler(req, res);
  } catch (fatalErr) {
    // Garante que SEMPRE volta JSON, mesmo em crash inesperado fora do fluxo normal
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

  const engRate = profileData.followersCount > 0 && profileData.avgLikes > 0
    ? (((profileData.avgLikes + profileData.avgComments) / profileData.followersCount) * 100).toFixed(2)
    : null;

  const quiz = profileData.quizAnswers;
  const quizContext = quiz ? `

DIAGNÓSTICO DO CLIENTE (respostas ao questionário estratégico — USE para personalizar completamente o plano):
- Tempo disponível para gravações: ${quiz.tempo_gravacoes}
- Responsável pela criação de conteúdo: ${quiz.responsavel_conteudo}
- Perfis/marcas de referência de comunicação: ${quiz.perfis_referencia}
- Objetivos principais do projeto: ${quiz.objetivos.join(', ')}
- Produto ou serviço prioritário: ${quiz.produto_prioritario}` : '';

  const prompt = `Você é um consultor sênior de estratégia digital especializado em Instagram, contratado pela OnFeX para gerar diagnósticos premium de perfis.

Pesquise na web por perfis reais e relevantes do Instagram no nicho "${profileData.niche}" no Brasil antes de responder (ex: busque "melhores perfis instagram ${profileData.niche}", "influenciadores ${profileData.niche} instagram brasil"). Use os resultados para identificar 10 perfis reais e ativos, relevantes ao nicho.

PERFIL ANALISADO:
- Username: @${profileData.username}
- Nicho: ${profileData.niche}
- Bio: ${profileData.biography || 'não informada'}
- Seguidores: ${profileData.followersCount || 'não informado'}
- Seguindo: ${profileData.followingCount || 'não informado'}
- Posts: ${profileData.postsCount || 'não informado'}
- Média curtidas: ${profileData.avgLikes || 'não informado'}
- Média comentários: ${profileData.avgComments || 'não informado'}
- Engajamento: ${engRate ? engRate + '%' : 'não calculado'}
- Verificado: ${profileData.isVerified ? 'Sim' : 'Não'}
- Highlights: ${profileData.highlightCount || 0}${quizContext}

Depois de pesquisar, responda SOMENTE com um bloco JSON válido. Não inclua nenhum texto, explicação ou comentário antes ou depois do JSON — sua última mensagem deve conter exclusivamente o JSON abaixo preenchido:

{
  "nota_geral": <0-100>,
  "classificacao": "<Iniciante|Em crescimento|Intermediário|Avançado|Autoridade>",
  "diagnostico_geral": "<2 parágrafos de diagnóstico honesto, específico, com tom consultivo premium>",
  "pontos_fortes": ["<3 pontos concretos>"],
  "pontos_fracos": ["<3 pontos concretos>"],
  "scores": {
    "posicionamento": <0-100>,
    "engajamento": <0-100>,
    "consistencia": <0-100>,
    "bio_e_identidade": <0-100>,
    "estrategia_de_conteudo": <0-100>
  },
  "projecao_faturamento": {
    "potencial_mensal_min": "<estimativa em R$, ex: 'R$ 3.000'>",
    "potencial_mensal_max": "<estimativa em R$, ex: 'R$ 12.000'>",
    "justificativa": "<1-2 frases explicando a base da estimativa considerando nicho, seguidores e engajamento>"
  },
  "plano_execucao": [
    {"prioridade": "Alta", "prazo": "Semana 1", "acao": "<título>", "descricao": "<1-2 frases práticas>"},
    {"prioridade": "Alta", "prazo": "Semana 2", "acao": "<título>", "descricao": "<1-2 frases práticas>"},
    {"prioridade": "Media", "prazo": "Mês 1", "acao": "<título>", "descricao": "<1-2 frases práticas>"},
    {"prioridade": "Media", "prazo": "Mês 1-2", "acao": "<título>", "descricao": "<1-2 frases práticas>"},
    {"prioridade": "Baixa", "prazo": "Mês 2", "acao": "<título>", "descricao": "<1-2 frases práticas>"}
  ],
  "bio_sugerida": "<bio otimizada pronta para usar>",
  "proximos_30_dias": "<2 parágrafos práticos, tom estratégico>",
  "cronograma_30_dias": [
    {
      "dia": 1,
      "feed": {"formato": "<Reels|Carrossel|Estático>", "pauta": "<título específico para o nicho>", "hook": "<frase de abertura>"},
      "stories": ["<ideia de story 1>", "<ideia de story 2>", "<ideia de story 3>"]
    }
  ],
  "referencias_virais": [
    {
      "perfil": "<@perfil real e ativo do Instagram, relevante para o nicho>",
      "tipo_conteudo": "<descrição específica do tipo de conteúdo que viraliza nesse perfil>",
      "por_que_funciona": "<explicação concreta>",
      "o_que_adaptar": "<como adaptar para o perfil analisado>"
    }
  ]
}

IMPORTANTE: cronograma_30_dias deve ter exatamente 30 entradas (um objeto por dia, de 1 a 30, variando entre temas Vendas/Trend/Educativo, sem repetir pautas). referencias_virais deve ter exatamente 10 perfis reais, diferentes entre si e relevantes ao nicho, encontrados via pesquisa na web.

RESTRIÇÃO DE TAMANHO (CRÍTICO): para evitar que a resposta seja cortada, seja extremamente conciso em cada campo de texto: "hook" no máximo 8 palavras, cada item de "stories" no máximo 10 palavras, "pauta" no máximo 10 palavras, "tipo_conteudo"/"por_que_funciona"/"o_que_adaptar" no máximo 15 palavras cada. Não adicione campos extras além dos especificados.`;

  try {
    let messages = [{ role: 'user', content: prompt }];
    let data = null;
    let finalText = '';

    // Loop simples: continua enquanto o modelo estiver usando ferramentas (web_search),
    // deixando a própria API anexar os tool_results automaticamente quando possível.
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
          max_tokens: 16000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
          messages
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        return res.status(400).json({ error: 'Erro Anthropic (' + response.status + '): ' + errBody.slice(0, 300) });
      }

      data = await response.json();

      // Junta todo texto gerado nesta resposta
      const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
      finalText += textBlocks.join('');

      if (data.stop_reason !== 'tool_use') break;

      // Servidor já processou a busca; precisamos só re-enviar a assistant message
      // e deixar claro que o resultado da tool já está embutido no bloco de conteúdo.
      messages.push({ role: 'assistant', content: data.content });

      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      const toolResultBlocks = toolUseBlocks.map(b => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: 'ok'
      }));
      messages.push({ role: 'user', content: toolResultBlocks });
    }

    let raw = finalText.replace(/```json|```/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'A IA não retornou um JSON válido. Tente novamente.' });
    }
    raw = raw.substring(start, end + 1);

    let result;
    try {
      result = JSON.parse(raw);
    } catch (parseErr) {
      // Tenta recuperar JSON cortado no meio (ex: array de 30 dias incompleto)
      // fechando arrays/objetos abertos da forma mais simples possível.
      try {
        let fixedRaw = raw;
        const openBraces = (fixedRaw.match(/{/g) || []).length;
        const closeBraces = (fixedRaw.match(/}/g) || []).length;
        const openBrackets = (fixedRaw.match(/\[/g) || []).length;
        const closeBrackets = (fixedRaw.match(/\]/g) || []).length;

        // Remove possível vírgula sobrando antes de fechar
        fixedRaw = fixedRaw.replace(/,\s*$/, '');

        for (let i = 0; i < (openBrackets - closeBrackets); i++) fixedRaw += ']';
        for (let i = 0; i < (openBraces - closeBraces); i++) fixedRaw += '}';

        result = JSON.parse(fixedRaw);
      } catch (recoveryErr) {
        return res.status(500).json({
          error: 'Resposta da IA veio incompleta ou malformada (provavelmente cortada por limite de tamanho). Tente novamente — análises de nichos muito extensos podem precisar de uma segunda tentativa.',
          debug_length: raw.length,
          debug_tail: raw.slice(-150)
        });
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar análise: ' + (err.message || 'erro desconhecido') });
  }
}
