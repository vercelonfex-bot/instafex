# InstaAnalyzer Pro — Guia de Deploy na Vercel

## Estrutura do projeto
```
instaanalyzer/
├── index.html          ← frontend
├── vercel.json         ← configuração Vercel
├── README.md           ← este arquivo
└── api/
    ├── apify.js        ← busca dados do Instagram (roda no servidor)
    └── analyze.js      ← gera análise com Claude AI (roda no servidor)
```

---

## Passo a passo: deploy na Vercel

### 1. Instale a CLI da Vercel
```bash
npm install -g vercel
```

### 2. Faça login
```bash
vercel login
```

### 3. Dentro da pasta do projeto, rode:
```bash
vercel
```
Responda as perguntas:
- "Set up and deploy?" → **Y**
- "Which scope?" → sua conta
- "Link to existing project?" → **N**
- "What's your project's name?" → `instaanalyzer` (ou o nome que quiser)
- "In which directory is your code located?" → **.**
- "Want to override the settings?" → **N**

Isso faz o primeiro deploy. Você receberá uma URL como `https://instaanalyzer-abc123.vercel.app`

---

## Configurar as variáveis de ambiente (tokens)

### Via painel web (mais fácil):
1. Acesse **vercel.com** → seu projeto → **Settings** → **Environment Variables**
2. Adicione as variáveis:

| Nome | Valor |
|------|-------|
| `APIFY_TOKEN` | seu token do Apify (console.apify.com → Settings → Integrations) |
| `ANTHROPIC_KEY` | sua chave da Anthropic (console.anthropic.com → API Keys) |
| `IG_APP_ID` | Instagram App ID (veja onde pegar abaixo) |
| `IG_APP_SECRET` | Instagram App Secret (veja onde pegar abaixo) |
| `META_REDIRECT_URI` | `https://seudominio.vercel.app/api/auth/callback` (a URL EXATA do seu site + `/api/auth/callback`) |
| `SESSION_SECRET` | qualquer string aleatória longa, ex: gere com `openssl rand -hex 32` |

3. Clique em **Save** para cada uma
4. Vá em **Deployments** → clique nos 3 pontinhos do deploy mais recente → **Redeploy**

### Via CLI:
```bash
vercel env add APIFY_TOKEN
vercel env add ANTHROPIC_KEY
vercel env add IG_APP_ID
vercel env add IG_APP_SECRET
vercel env add META_REDIRECT_URI
vercel env add SESSION_SECRET
vercel --prod
```

---

## Configurar o login do Instagram (Etapa 2)

Esse projeto usa o fluxo **"Business Login for Instagram"** (API do Instagram com Login do Instagram) — a versão mais nova, que **não exige Página do Facebook vinculada**.

1. No painel do app, no menu lateral: **Instagram → Configuração da API com login do Instagram**
2. Vá até **"3. Configurar o login do Instagram para empresas" → Configurações do login para empresas**
3. Copie ali mesmo:
   - **Instagram App ID** → use como `IG_APP_ID`
   - **Instagram App Secret** → use como `IG_APP_SECRET`
   (são diferentes do "ID do aplicativo"/"Chave secreta" que aparecem em Configurações → Básico — use os que aparecem especificamente nessa tela do Instagram)
4. Nessa mesma tela, em **"URIs de redirecionamento OAuth"**, adicione:
   ```
   https://seudominio.vercel.app/api/auth/callback
   ```
5. Salve.
6. Em **Funções do app → Testadores**, adicione o @ das contas que vão testar (enquanto o app estiver em "Em desenvolvimento", só essas contas conseguem conectar). A pessoa precisa aceitar o convite no próprio Instagram.
7. Para liberar pra qualquer cliente seu (sem precisar adicionar como testador), será necessário submeter o app para **App Review** solicitando `instagram_business_basic` e `instagram_business_manage_insights` — leva de 2 a 6 semanas.

**Importante:** a conta do Instagram que o cliente for conectar precisa ser **Business ou Creator** (conta pessoal não funciona), mas **não precisa mais estar vinculada a uma Página do Facebook** nesse fluxo.

---





## Testar localmente (opcional)

Crie um arquivo `.env.local` na raiz:
```
APIFY_TOKEN=apify_api_seu_token_aqui
ANTHROPIC_KEY=sk-ant-api03-sua_chave_aqui
```

Depois rode:
```bash
vercel dev
```
Acesse `http://localhost:3000`

---

## Domínio personalizado (opcional)
No painel Vercel → **Settings** → **Domains** → adicione seu domínio.

---

## Custo estimado por análise
- Apify: ~$0,30–0,50 por perfil
- Anthropic (Claude Sonnet): ~$0,01–0,03 por análise
- Vercel: gratuito para uso pessoal/comercial leve

---

## Dúvidas frequentes

**"Apify não disponível" mesmo com token configurado?**
→ Verifique se a variável `APIFY_TOKEN` está nas env vars da Vercel e que você fez redeploy após adicionar.

**Perfil não encontrado?**
→ O perfil pode ser privado. O Apify só acessa perfis públicos.

**Como cobrar dos clientes?**
→ Custo médio por análise: R$ 1–2. Você pode cobrar R$ 97–497 por relatório dependendo do seu posicionamento.
