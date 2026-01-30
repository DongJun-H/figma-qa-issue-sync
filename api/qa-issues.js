const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-QA-Secret');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

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
  const projectName = payload?.projectName || process.env.GITHUB_PROJECT_NAME;
  const projectOwner = payload?.projectOwner || process.env.GITHUB_PROJECT_OWNER || owner;
  const projectNumberRaw = payload?.projectNumber || process.env.GITHUB_PROJECT_NUMBER;
  const projectNumber = projectNumberRaw ? Number(projectNumberRaw) : null;
  if (!owner || !repo || !Array.isArray(issues)) {
    return res.status(400).json({ error: 'Invalid payload: owner, repo, issues required' });
  }

  const results = [];
  let created = 0;
  let failed = 0;
  let projectId = null;

  if (projectNumber && projectOwner) {
    try {
      projectId = await fetchProjectIdByNumber(token, projectOwner, projectNumber);
    } catch (error) {
      projectId = null;
    }
  } else if (projectName && projectOwner) {
    try {
      projectId = await fetchProjectId(token, projectOwner, projectName);
    } catch (error) {
      projectId = null;
    }
  }

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
        projectStatus: await addIssueToProject(token, projectId, data?.node_id),
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

async function addIssueToProject(token, projectId, contentId) {
  if (!projectId || !contentId) return undefined;

  try {
    const response = await fetch(GITHUB_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        query: `
          mutation($projectId: ID!, $contentId: ID!) {
            addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
              item { id }
            }
          }
        `,
        variables: { projectId, contentId },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) {
      const errorMessage = payload?.errors
        ? payload.errors.map((error) => error.message).join('; ')
        : payload?.message || response.statusText;
      return { status: response.status, error: errorMessage };
    }
    return { status: response.status };
  } catch (error) {
    return { status: 0, error: error?.message || 'Unknown error' };
  }
}

async function fetchProjectId(token, owner, projectName) {
  const orgResult = await fetchProjectList(token, 'organization', owner);
  const orgProject = orgResult?.organization?.projectsV2?.nodes?.find((node) => node.title === projectName);
  if (orgProject?.id) return orgProject.id;

  const userResult = await fetchProjectList(token, 'user', owner);
  const userProject = userResult?.user?.projectsV2?.nodes?.find((node) => node.title === projectName);
  if (userProject?.id) return userProject.id;

  return null;
}

async function fetchProjectIdByNumber(token, owner, projectNumber) {
  const orgResult = await fetchProjectByNumber(token, 'organization', owner, projectNumber);
  const orgProject = orgResult?.organization?.projectV2;
  if (orgProject?.id) return orgProject.id;

  const userResult = await fetchProjectByNumber(token, 'user', owner, projectNumber);
  const userProject = userResult?.user?.projectV2;
  if (userProject?.id) return userProject.id;

  return null;
}

async function fetchProjectList(token, ownerType, login) {
  const query = ownerType === 'organization'
    ? `
      query($login: String!) {
        organization(login: $login) {
          projectsV2(first: 50) {
            nodes { id title }
          }
        }
      }
    `
    : `
      query($login: String!) {
        user(login: $login) {
          projectsV2(first: 50) {
            nodes { id title }
          }
        }
      }
    `;

  const response = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      query,
      variables: { login },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (data?.errors?.length) {
    console.error('Project list lookup error', data.errors);
  }
  return data?.data;
}

async function fetchProjectByNumber(token, ownerType, login, projectNumber) {
  const query = ownerType === 'organization'
    ? `
      query($login: String!, $number: Int!) {
        organization(login: $login) {
          projectV2(number: $number) {
            id
            title
          }
        }
      }
    `
    : `
      query($login: String!, $number: Int!) {
        user(login: $login) {
          projectV2(number: $number) {
            id
            title
          }
        }
      }
    `;

  const response = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      query,
      variables: { login, number: projectNumber },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (data?.errors?.length) {
    console.error('Project number lookup error', data.errors);
  }
  return data?.data;
}
