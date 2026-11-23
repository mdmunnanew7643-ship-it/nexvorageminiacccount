const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const VAULT_PASSWORD = process.env.VAULT_PASSWORD || 'PedroMendes2233';
const SESSION_COOKIE_NAME = 'nv_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'gmail-accounts.json');
const BACKUP_FILE = path.join(DATA_DIR, 'gmail-accounts.backup.json');
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const IS_RENDER = Boolean(process.env.RENDER);

// Derive deterministic signing key (or use SESSION_SECRET env var if provided)
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`nexvora-vault-key::${VAULT_PASSWORD}`).digest('hex');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Optional PostgreSQL pool when DATABASE_URL is configured
let pgPool = null;
let pgReady = false;

function shouldUseSsl(connStr) {
  if (/sslmode=disable/i.test(connStr)) return false;
  if (/localhost|127\.0\.0\.1/i.test(connStr)) return false;
  return true;
}

async function initStorage() {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
    });

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS vault_accounts (
        id TEXT PRIMARY KEY,
        main_gmail TEXT NOT NULL,
        password TEXT NOT NULL DEFAULT '',
        two_factor TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        invite_gmails JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    pgReady = true;
    console.log('Connected to PostgreSQL permanent database.');
  } else {
    ensureDataStorage();
    console.log(`Using local JSON storage: ${DATA_FILE}`);
  }
}

function rowToAccount(row) {
  return {
    id: row.id,
    mainGmail: row.main_gmail,
    password: row.password || '',
    twoFactor: row.two_factor || '',
    label: row.label || '',
    notes: row.notes || '',
    inviteGmails: Array.isArray(row.invite_gmails) ? row.invite_gmails : [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
  };
}

function ensureDataStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { version: 1, updatedAt: new Date().toISOString(), accounts: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readLocalStore() {
  ensureDataStorage();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.accounts)) {
      return { version: 1, updatedAt: new Date().toISOString(), accounts: [] };
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read primary data file, trying backup:', err.message);
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.accounts)) {
        return parsed;
      }
    }
    return { version: 1, updatedAt: new Date().toISOString(), accounts: [] };
  }
}

function writeLocalStore(store) {
  ensureDataStorage();
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    accounts: store.accounts,
  };
  const serialized = JSON.stringify(payload, null, 2);

  if (fs.existsSync(DATA_FILE)) {
    try {
      fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    } catch (err) {
      console.warn('Could not update backup file:', err.message);
    }
  }

  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, serialized, 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
  return payload;
}

// Unified storage operations (PostgreSQL or Local JSON)
async function getAllAccounts() {
  if (pgReady && pgPool) {
    const { rows } = await pgPool.query(
      'SELECT id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at FROM vault_accounts ORDER BY created_at DESC'
    );
    return rows.map(rowToAccount);
  }
  const store = readLocalStore();
  return store.accounts;
}

async function createAccountRecord(acc) {
  if (pgReady && pgPool) {
    const { rows } = await pgPool.query(
      `INSERT INTO vault_accounts (id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at`,
      [
        acc.id,
        acc.mainGmail,
        acc.password,
        acc.twoFactor,
        acc.label,
        acc.notes,
        JSON.stringify(acc.inviteGmails),
        acc.createdAt,
        acc.updatedAt,
      ]
    );
    return rowToAccount(rows[0]);
  }
  const store = readLocalStore();
  store.accounts.unshift(acc);
  writeLocalStore(store);
  return acc;
}

async function updateAccountRecord(id, fields) {
  const now = new Date().toISOString();
  if (pgReady && pgPool) {
    const { rows } = await pgPool.query(
      `UPDATE vault_accounts
       SET main_gmail = $2,
           password = $3,
           two_factor = $4,
           label = $5,
           notes = $6,
           invite_gmails = $7::jsonb,
           updated_at = $8
       WHERE id = $1
       RETURNING id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at`,
      [
        id,
        fields.mainGmail,
        fields.password,
        fields.twoFactor,
        fields.label,
        fields.notes,
        JSON.stringify(fields.inviteGmails),
        now,
      ]
    );
    return rows.length ? rowToAccount(rows[0]) : null;
  }

  const store = readLocalStore();
  const index = store.accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;

  const updated = {
    ...store.accounts[index],
    ...fields,
    updatedAt: now,
  };
  store.accounts[index] = updated;
  writeLocalStore(store);
  return updated;
}

async function deleteAccountRecord(id) {
  if (pgReady && pgPool) {
    const { rows } = await pgPool.query(
      `DELETE FROM vault_accounts WHERE id = $1
       RETURNING id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at`,
      [id]
    );
    return rows.length ? rowToAccount(rows[0]) : null;
  }

  const store = readLocalStore();
  const index = store.accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;

  const [removed] = store.accounts.splice(index, 1);
  writeLocalStore(store);
  return removed;
}

async function importAccountRecords(incoming) {
  if (pgReady && pgPool) {
    let added = 0;
    for (const rawAcc of incoming) {
      const mainGmail = String(rawAcc.mainGmail || '').trim();
      if (!mainGmail) continue;

      const id = rawAcc.id && typeof rawAcc.id === 'string' ? rawAcc.id : crypto.randomUUID();
      const now = new Date().toISOString();
      const res = await pgPool.query(
        `INSERT INTO vault_accounts (id, main_gmail, password, two_factor, label, notes, invite_gmails, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          mainGmail,
          String(rawAcc.password || '').trim(),
          String(rawAcc.twoFactor || '').trim(),
          String(rawAcc.label || '').trim(),
          String(rawAcc.notes || '').trim(),
          JSON.stringify(normalizeInviteGmails(rawAcc.inviteGmails)),
          rawAcc.createdAt || now,
          rawAcc.updatedAt || now,
        ]
      );
      if (res.rowCount > 0) added += 1;
    }
    const { rows } = await pgPool.query('SELECT COUNT(*)::int AS cnt FROM vault_accounts');
    return { imported: added, totalCount: rows[0].cnt };
  }

  const store = readLocalStore();
  const existingIds = new Set(store.accounts.map((a) => a.id));
  let added = 0;

  for (const rawAcc of incoming) {
    const mainGmail = String(rawAcc.mainGmail || '').trim();
    if (!mainGmail) continue;

    const id = rawAcc.id && typeof rawAcc.id === 'string' ? rawAcc.id : crypto.randomUUID();
    if (existingIds.has(id)) continue;

    const now = new Date().toISOString();
    store.accounts.push({
      id,
      mainGmail,
      password: String(rawAcc.password || '').trim(),
      twoFactor: String(rawAcc.twoFactor || '').trim(),
      label: String(rawAcc.label || '').trim(),
      notes: String(rawAcc.notes || '').trim(),
      inviteGmails: normalizeInviteGmails(rawAcc.inviteGmails),
      createdAt: rawAcc.createdAt || now,
      updatedAt: rawAcc.updatedAt || now,
    });
    existingIds.add(id);
    added += 1;
  }

  writeLocalStore(store);
  return { imported: added, totalCount: store.accounts.length };
}

function getStorageMeta() {
  if (pgReady) {
    return {
      storageMode: 'postgres',
      storageFile: 'PostgreSQL Cloud DB (Permanent)',
    };
  }
  if (IS_RENDER && !process.env.DATA_DIR) {
    return {
      storageMode: 'ephemeral',
      storageFile: 'Temporary Disk — Add DATABASE_URL',
    };
  }
  return {
    storageMode: 'local',
    storageFile: path.relative(ROOT_DIR, DATA_FILE) || DATA_FILE,
  };
}

// Authentication helpers
function verifyPassword(input) {
  const expectedHash = crypto.createHash('sha256').update(String(VAULT_PASSWORD)).digest();
  const actualHash = crypto.createHash('sha256').update(String(input || '')).digest();
  return crypto.timingSafeEqual(expectedHash, actualHash);
}

function createSessionToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const payload = `${expStr}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const actualBuf = Buffer.from(sig, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function buildSessionCookie(req, token, maxAgeSeconds) {
  const isHttps =
    req.headers['x-forwarded-proto'] === 'https' ||
    Boolean(req.socket && req.socket.encrypted);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) attrs.push('Secure');
  return attrs.join('; ');
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function normalizeInviteGmails(input) {
  if (!Array.isArray(input)) return [];
  const now = new Date().toISOString();
  const result = [];

  for (const item of input) {
    if (typeof item === 'string') {
      const email = item.trim();
      if (email) {
        result.push({
          id: crypto.randomUUID(),
          email,
          note: '',
          addedAt: now,
        });
      }
    } else if (item && typeof item === 'object') {
      const email = String(item.email || '').trim();
      if (email) {
        result.push({
          id: item.id && typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          email,
          note: String(item.note || '').trim(),
          addedAt: item.addedAt || now,
        });
      }
    }
  }
  return result;
}

function serveStaticFile(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

async function handleApi(req, res, urlObj) {
  const { pathname, searchParams } = urlObj;

  // Public health check for Render
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', storageMode: getStorageMeta().storageMode });
    return;
  }

  // Auth status
  if (req.method === 'GET' && pathname === '/api/auth/status') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return;
  }

  // Login
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await readRequestBody(req);
      if (!verifyPassword(body.password)) {
        sendJson(res, 401, { error: 'Incorrect password. Please try again.' });
        return;
      }
      const token = createSessionToken();
      const cookie = buildSessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000));
      sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': cookie });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Logout / Lock
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const cookie = buildSessionCookie(req, '', 0);
    sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': cookie });
    return;
  }

  // Require authentication for all vault data APIs
  if (!isAuthenticated(req)) {
    sendJson(res, 401, { error: 'Authentication required. Please unlock the vault.' });
    return;
  }

  // GET all accounts (optional search query ?q=)
  if (req.method === 'GET' && pathname === '/api/accounts') {
    const allAccounts = await getAllAccounts();
    const query = (searchParams.get('q') || '').trim().toLowerCase();

    let accounts = allAccounts;
    if (query) {
      accounts = allAccounts.filter((acc) => {
        const inMain = (acc.mainGmail || '').toLowerCase().includes(query);
        const inLabel = (acc.label || '').toLowerCase().includes(query);
        const inTwoFactor = (acc.twoFactor || '').toLowerCase().includes(query);
        const inNotes = (acc.notes || '').toLowerCase().includes(query);
        const inInvites = (acc.inviteGmails || []).some(
          (inv) =>
            (inv.email || '').toLowerCase().includes(query) ||
            (inv.note || '').toLowerCase().includes(query)
        );
        return inMain || inLabel || inTwoFactor || inNotes || inInvites;
      });
    }

    const meta = getStorageMeta();
    sendJson(res, 200, {
      accounts,
      totalCount: allAccounts.length,
      storageFile: meta.storageFile,
      storageMode: meta.storageMode,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // POST create new account
  if (req.method === 'POST' && pathname === '/api/accounts') {
    try {
      const body = await readRequestBody(req);
      const mainGmail = String(body.mainGmail || '').trim();
      if (!mainGmail) {
        sendJson(res, 400, { error: 'Main Gmail address is required.' });
        return;
      }

      const now = new Date().toISOString();
      const newAccount = await createAccountRecord({
        id: crypto.randomUUID(),
        mainGmail,
        password: String(body.password || '').trim(),
        twoFactor: String(body.twoFactor || '').trim(),
        label: String(body.label || '').trim(),
        notes: String(body.notes || '').trim(),
        inviteGmails: normalizeInviteGmails(body.inviteGmails),
        createdAt: now,
        updatedAt: now,
      });

      sendJson(res, 201, { account: newAccount });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Export JSON backup
  if (req.method === 'GET' && pathname === '/api/export') {
    const accounts = await getAllAccounts();
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      accounts,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="nexvora-gmail-backup-${stamp}.json"`,
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  // Import JSON backup (merges non-duplicate IDs)
  if (req.method === 'POST' && pathname === '/api/import') {
    try {
      const body = await readRequestBody(req);
      const incoming = Array.isArray(body.accounts) ? body.accounts : [];
      if (!incoming.length) {
        sendJson(res, 400, { error: 'No valid accounts found in backup file.' });
        return;
      }

      const result = await importAccountRecords(incoming);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Match /api/accounts/:id
  const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch) {
    const accountId = decodeURIComponent(accountMatch[1]);

    if (req.method === 'PUT') {
      try {
        const body = await readRequestBody(req);
        const mainGmail = String(body.mainGmail || '').trim();
        if (!mainGmail) {
          sendJson(res, 400, { error: 'Main Gmail address is required.' });
          return;
        }

        const updated = await updateAccountRecord(accountId, {
          mainGmail,
          password: String(body.password || '').trim(),
          twoFactor: String(body.twoFactor || '').trim(),
          label: String(body.label || '').trim(),
          notes: String(body.notes || '').trim(),
          inviteGmails: normalizeInviteGmails(body.inviteGmails),
        });

        if (!updated) {
          sendJson(res, 404, { error: 'Account not found.' });
          return;
        }

        sendJson(res, 200, { account: updated });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    if (req.method === 'DELETE') {
      const removed = await deleteAccountRecord(accountId);
      if (!removed) {
        sendJson(res, 404, { error: 'Account not found.' });
        return;
      }
      sendJson(res, 200, { deleted: removed });
      return;
    }
  }

  sendJson(res, 404, { error: 'API endpoint not found.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
    } else {
      serveStaticFile(req, res, urlObj.pathname);
    }
  } catch (err) {
    console.error('Unhandled request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

initStorage()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Nexvora Gmail Vault server running at http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
  });
