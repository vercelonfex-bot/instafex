// api/auth/logout.js
import { applyCookies, clearSessionCookie } from '../../lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  applyCookies(res, [clearSessionCookie()]);
  return res.status(200).json({ ok: true });
}
