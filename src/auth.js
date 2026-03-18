const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-' + Date.now();
const TOKEN_EXPIRY = '24h';
const COOKIE_NAME = 'enshittindex_token';

function getPasswordHash() {
  return db.getSetting('admin_password_hash');
}

async function setPassword(plaintext) {
  const hash = await bcrypt.hash(plaintext, 12);
  db.setSetting('admin_password_hash', hash);
  return hash;
}

async function verifyPassword(plaintext) {
  const hash = getPasswordHash();
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

function generateToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  });
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  return verifyToken(token) !== null;
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
  );
}

module.exports = {
  getPasswordHash,
  setPassword,
  verifyPassword,
  generateToken,
  isAuthenticated,
  setAuthCookie,
  clearAuthCookie,
  COOKIE_NAME,
};
