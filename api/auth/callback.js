// api/auth/callback.js
// O Instagram redireciona pra cá com um ?code=... depois do usuário logar na tela oficial.
// Fluxo "Business Login for Instagram": troca o code por um token direto, sem precisar
// de Página do Facebook vinculada (diferente do fluxo antigo via Facebook Login).

import { parseCookies, STATE_COOKIE, applyCookies, sessionCookie, clearStateCookie } from '../../lib/session.js';

const OAUTH_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_IG = 'https://graph.instagram.com/v21.0';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return redirectWithErr(res, error_description || error);
    }

    const cookies = parseCookies(req);
    if (!state || state !== cookies[STATE_COOKIE]) {
      return redirectWithErr(res, 'Estado OAuth inválido ou expirado. Tente conectar novamente.');
    }

    const appId = process.env.IG_APP_ID;
    const appSecret = process.env.IG_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI;

    // 1. Troca o code por um token de curta duração (POST com form-data, não query string)
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: code
    });

    const shortRes = await fetch(OAUTH_TOKEN_URL, { method: 'POST', body: form });
    const shortData = await shortRes.json();

    // A API retorna { data: [{ access_token, user_id, permissions }] } ou direto { access_token, user_id }
    const shortInfo = shortData.data ? shortData.data[0] : shortData;
    if (!shortInfo || !shortInfo.access_token) {
      return redirectWithErr(res, 'Falha ao obter token de acesso: ' + (shortData.error_message || JSON.stringify(shortData)));
    }

    // 2. Troca por um token de longa duração (~60 dias)
    const longParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: shortInfo.access_token
    });
    const longRes = await fetch(`${GRAPH_IG}/access_token?${longParams.toString()}`);
    const longData = await longRes.json();
    const accessToken = longData.access_token || shortInfo.access_token;
    const expiresIn = longData.expires_in || 5184000; // 60 dias padrão se a API não informar

    const igUserId = shortInfo.user_id;

    // 3. Busca dados básicos da conta Instagram conectada
    const igRes = await fetch(`${GRAPH_IG}/me?fields=user_id,username,account_type&access_token=${accessToken}`);
    const igData = await igRes.json();

    const sessionData = {
      accessToken,
      igUserId: String(igData.user_id || igUserId),
      igUsername: igData.username || '',
      accountType: igData.account_type || '',
      connectedAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000
    };

    res.writeHead(302, {
      'Set-Cookie': [sessionCookie(sessionData, expiresIn), clearStateCookie()],
      'Location': '/?conectado=1',
      'Cache-Control': 'no-store, max-age=0'
    });
    res.end();
  } catch (err) {
    return redirectWithErr(res, 'Erro inesperado: ' + (err.message || 'desconhecido'));
  }
}

function redirectWithErr(res, msg) {
  res.writeHead(302, {
    'Location': '/?erro=' + encodeURIComponent(msg),
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end();
}
