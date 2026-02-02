const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-QA-Session');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Poll by state (during OAuth flow)
  const { state } = req.query;
  if (state) {
    const stateData = await kv.get(`oauth:state:${state}`);
    if (!stateData) {
      return res.json({ authenticated: false, error: 'State not found' });
    }
    if (stateData.status === 'completed') {
      return res.json({
        authenticated: true,
        sessionId: stateData.sessionId,
        user: { login: stateData.login }
      });
    }
    return res.json({ authenticated: false, status: stateData.status });
  }

  // Check existing session
  const sessionId = req.headers['x-qa-session'];
  if (sessionId) {
    const session = await kv.get(`oauth:session:${sessionId}`);
    if (session) {
      return res.json({
        authenticated: true,
        user: {
          login: session.login,
          avatarUrl: session.avatarUrl
        }
      });
    }
  }

  return res.json({ authenticated: false });
};
