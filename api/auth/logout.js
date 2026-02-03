const { kv } = require('@vercel/kv');
const { setCorsHeaders } = require('../../lib/security');

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const sessionId = req.headers['x-qa-session'];
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'No session provided' });
  }

  const deleted = await kv.del(`oauth:session:${sessionId}`);
  if (deleted === 0) {
    return res.json({ success: false, error: 'Session not found or already expired' });
  }

  return res.json({ success: true });
};
