const { kv } = require('@vercel/kv');
const crypto = require('crypto');
const { encrypt } = require('../../lib/crypto');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;

  // Handle GitHub OAuth error
  if (error) {
    return sendErrorPage(res, 'GitHub 인증이 거부되었습니다.');
  }

  if (!code || !state) {
    return sendErrorPage(res, '잘못된 요청입니다.');
  }

  // Verify state (provides CSRF protection)
  const stateData = await kv.get(`oauth:state:${state}`);
  if (!stateData || stateData.status !== 'pending') {
    return sendErrorPage(res, '로그인 세션이 만료되었습니다. 다시 시도해주세요.');
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    })
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    console.error('Token exchange failed:', tokenData.error_description || tokenData.error);
    return sendErrorPage(res, '인증에 실패했습니다. 다시 시도해주세요.');
  }

  // Fetch user info
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!userRes.ok) {
    return sendErrorPage(res, '사용자 정보를 가져올 수 없습니다.');
  }

  const userData = await userRes.json();

  // Create session with encrypted token
  const sessionId = crypto.randomUUID();
  await kv.set(`oauth:session:${sessionId}`, {
    accessToken: encrypt(tokenData.access_token),
    userId: userData.id,
    login: userData.login,
    avatarUrl: userData.avatar_url,
    createdAt: Date.now()
  }, { ex: 60 * 60 * 24 }); // 24 hours TTL (shortened from 7 days)

  // Update state to completed
  await kv.set(`oauth:state:${state}`, {
    ...stateData,
    status: 'completed',
    sessionId,
    login: userData.login
  }, { ex: 600 });

  return sendSuccessPage(res, userData.login);
};

function sendSuccessPage(res, login) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>인증 완료</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px 0;
      color: #1f2937;
      font-size: 24px;
    }
    p {
      color: #6b7280;
      margin: 0;
      font-size: 16px;
    }
    .user {
      color: #2563eb;
      font-weight: 600;
    }
    .hint {
      margin-top: 24px;
      font-size: 14px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>로그인 완료!</h1>
    <p><span class="user">@${escapeHtml(login)}</span>으로 로그인되었습니다.</p>
    <p class="hint">이 창을 닫고 Figma로 돌아가주세요.</p>
  </div>
</body>
</html>
  `);
}

function sendErrorPage(res, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(400).send(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>인증 실패</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px 0;
      color: #1f2937;
      font-size: 24px;
    }
    p {
      color: #6b7280;
      margin: 0;
      font-size: 16px;
    }
    .hint {
      margin-top: 24px;
      font-size: 14px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10006;</div>
    <h1>인증 실패</h1>
    <p>${escapeHtml(message)}</p>
    <p class="hint">이 창을 닫고 다시 시도해주세요.</p>
  </div>
</body>
</html>
  `);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
