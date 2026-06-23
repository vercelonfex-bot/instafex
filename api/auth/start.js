// api/auth/start.js
// Redireciona o usuário para a tela OFICIAL de login do Instagram (Business Login for Instagram).
// Nenhuma senha passa pelo nosso servidor em nenhum momento — o usuário digita
// a senha dele diretamente em instagram.com, que devolve só um código de autorização.
//
// Esse é o fluxo "Instagram API with Instagram Login": não exige Página do Facebook
// vinculada, usa endpoints em instagram.com/graph.instagram.com e permissões
// instagram_business_* (diferente do fluxo antigo via facebook.com/graph.facebook.com).

import crypto from 'crypto';
import { applyCookies, stateCookie } from '../../lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const appId = process.env.IG_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return res.status(500).send('IG_APP_ID ou META_REDIRECT_URI não configurados nas variáveis de ambiente da Vercel.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  applyCookies(res, [stateCookie(state)]);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_insights'
  });

  res.writeHead(302, { Location: `https://www.instagram.com/oauth/authorize?${params.toString()}` });
  res.end();
}
