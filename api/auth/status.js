// api/auth/status.js
import { getSession } from '../../lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const session = getSession(req);

  if (!session || !session.accessToken) {
    return res.status(200).json({ connected: false });
  }

  return res.status(200).json({
    connected: true,
    igUsername: session.igUsername || '',
    igUserId: session.igUserId,
    connectedAt: session.connectedAt,
    expiresAt: session.expiresAt
  });
}
