const { kv } = require('@vercel/kv');
const crypto = require('crypto');
const { setCorsHeaders, createFingerprint } = require('../../lib/security');

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

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

  // Create state with fingerprint for enhanced CSRF protection
  const stateData = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: 'pending',
    fingerprint: createFingerprint(req.headers['user-agent'])
  };

  // Store state in KV with 10 minute TTL
  await kv.set(`oauth:state:${stateData.id}`, stateData, { ex: 600 });
  const state = stateData.id;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo',
    state
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params}`;

  return res.json({ authUrl, state });
};
