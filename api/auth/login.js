const { kv } = require('@vercel/kv');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const callbackUrl = process.env.OAUTH_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  const state = crypto.randomUUID();

  // Store state in KV with 10 minute TTL
  await kv.set(`oauth:state:${state}`, {
    createdAt: Date.now(),
    status: 'pending'
  }, { ex: 600 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo',
    state
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params}`;

  return res.json({ authUrl, state });
};
