// lib/session.js
// Gerencia a sessão do usuário via cookie HttpOnly assinado (HMAC-SHA256).
// O token de acesso do Instagram NUNCA é exposto ao JavaScript do navegador —
// fica só no cookie HttpOnly, lido apenas pelas funções serverless.
//
// Observação para escalar depois: para múltiplos usuários simultâneos em produção,
// o ideal é migrar isso para uma tabela em banco de dados (Vercel Postgres/KV) em vez
// de cookie. Para o estágio atual (poucos usuários / uso interno), cookie assinado é seguro
// o suficiente porque é HttpOnly (JS não acessa) e a assinatura impede adulteração.

import crypto from 'crypto';

export const SESSION_COOKIE = 'ig_session';
export const STATE_COOKIE = 'ig_oauth_state';

function secret() {
  const s = process.env.SESSION_SECRET || process.env.META_APP_SECRET;
  if (!s) throw new Error('Configure SESSION_SECRET (ou META_APP_SECRET) nas variáveis de ambiente.');
  return s;
}

export function pack(data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function unpack(value) {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig !== expected) return null; // assinatura inválida — cookie adulterado ou de outra chave
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function cookieStr(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function applyCookies(res, cookies) {
  res.setHeader('Set-Cookie', cookies);
}

export function sessionCookie(data, maxAgeSeconds) {
  return cookieStr(SESSION_COOKIE, pack(data), maxAgeSeconds);
}
export function clearSessionCookie() {
  return cookieStr(SESSION_COOKIE, '', 0);
}
export function stateCookie(state) {
  return cookieStr(STATE_COOKIE, state, 600); // 10 min — só dura o tempo do fluxo OAuth
}
export function clearStateCookie() {
  return cookieStr(STATE_COOKIE, '', 0);
}

export function getSession(req) {
  const cookies = parseCookies(req);
  return unpack(cookies[SESSION_COOKIE]);
}
