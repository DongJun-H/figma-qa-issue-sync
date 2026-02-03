const crypto = require('crypto');

const ALLOWED_ORIGINS = [
  'https://www.figma.com',
  'https://figma.com',
  'null',     // Figma plugin sends "null" as string
  null,       // No origin header
  undefined   // No origin header
];

const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const REPO_REGEX = /^[a-zA-Z0-9._-]+$/;
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 65536;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'null');
  }
  // If origin is not in allowed list, don't set CORS headers

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-QA-Secret, X-QA-Session');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function validateOwnerRepo(owner, repo) {
  if (!owner || !repo) return false;
  if (typeof owner !== 'string' || typeof repo !== 'string') return false;
  if (owner.length > 39 || repo.length > 100) return false;
  if (!OWNER_REGEX.test(owner)) return false;
  if (!REPO_REGEX.test(repo)) return false;
  return true;
}

function validateIssue(issue) {
  if (!issue || typeof issue !== 'object') return false;
  if (!issue.title || !issue.body) return false;
  if (typeof issue.title !== 'string' || typeof issue.body !== 'string') return false;
  if (issue.title.length > MAX_TITLE_LENGTH) return false;
  if (issue.body.length > MAX_BODY_LENGTH) return false;
  return true;
}

function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// State fingerprint for CSRF protection
function createFingerprint(userAgent) {
  return crypto.createHash('sha256')
    .update(userAgent || '')
    .digest('hex')
    .slice(0, 16);
}

function verifyFingerprint(storedFingerprint, userAgent) {
  const currentFingerprint = createFingerprint(userAgent);
  return storedFingerprint === currentFingerprint;
}

module.exports = {
  ALLOWED_ORIGINS,
  setCorsHeaders,
  validateOwnerRepo,
  validateIssue,
  sanitizeString,
  escapeHtml,
  createFingerprint,
  verifyFingerprint,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH
};
