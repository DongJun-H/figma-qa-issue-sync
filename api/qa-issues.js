const GITHUB_API_BASE = 'https://api.github.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const secret = process.env.QA_SYNC_SECRET;
  if (secret) {
    const provided = req.headers['x-qa-secret'];
    if (!provided || provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (error) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const { owner, repo, issues } = payload || {};
  if (!owner || !repo || !Array.isArray(issues)) {
    return res.status(400).json({ error: 'Invalid payload: owner, repo, issues required' });
  }

  const results = [];
  let created = 0;
  let failed = 0;

  for (const issue of issues) {
    const {
      title,
      body,
      labels = [],
      nodeId,
      signature,
    } = issue || {};

    if (!title || !body) {
      failed += 1;
      results.push({
        nodeId,
        signature,
        status: 400,
        error: 'Missing title or body',
      });
      continue;
    }

    try {
      const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          title,
          body,
          labels: Array.isArray(labels) ? labels : [],
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        failed += 1;
        results.push({
          nodeId,
          signature,
          status: response.status,
          error: data?.message || response.statusText,
        });
        continue;
      }

      created += 1;
      results.push({
        nodeId,
        signature,
        status: response.status,
        url: data?.html_url,
      });
    } catch (error) {
      failed += 1;
      results.push({
        nodeId,
        signature,
        status: 500,
        error: error?.message || 'Unknown error',
      });
    }
  }

  return res.status(200).json({ created, failed, results });
};
