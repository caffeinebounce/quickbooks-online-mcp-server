#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import open from 'open';
import OAuthClient from 'intuit-oauth';
import dotenv from 'dotenv';

const candidates = [
  process.env.QUICKBOOKS_ENV_FILE,
  path.join(process.env.HOME || '', 'mcp-servers/quickbooks/.env'),
  path.join(process.cwd(), '.env'),
].filter(Boolean);
const envFile = candidates.find((p) => fs.existsSync(p));
if (envFile) dotenv.config({ path: envFile, override: false });
else dotenv.config();

const clientId = process.env.QUICKBOOKS_CLIENT_ID;
const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'production';
const redirectUri = process.env.QUICKBOOKS_REDIRECTURI || 'http://localhost:8000/callback';

if (!clientId || !clientSecret) {
  console.error('Missing QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET');
  process.exit(1);
}

const oauthClient = new OAuthClient({ clientId, clientSecret, environment, redirectUri });
const url = new URL(redirectUri);
const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));

function updateEnv(updates) {
  const target = envFile || candidates[0] || path.join(process.cwd(), '.env');
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const lines = current.split('\n').filter(Boolean);
  const map = new Map(lines.map((l) => {
    const i = l.indexOf('=');
    return i === -1 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)];
  }));
  for (const [k, v] of Object.entries(updates)) map.set(k, String(v));
  const out = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(target, out);
  console.log(`Updated ${target}`);
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith(url.pathname)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const tokenResp = await oauthClient.createToken(req.url);
    const token = tokenResp.token;
    updateEnv({
      QUICKBOOKS_REFRESH_TOKEN: token.refresh_token,
      QUICKBOOKS_REALM_ID: token.realmId,
    });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>QuickBooks OAuth complete. You can close this window.</h2>');
    console.log('OAuth bootstrap complete.');
    setTimeout(() => server.close(() => process.exit(0)), 500);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`OAuth error: ${e.message}`);
    console.error(e);
  }
});

server.listen(port, () => {
  const authUri = oauthClient.authorizeUri({ scope: [OAuthClient.scopes.Accounting], state: 'qb-bootstrap' }).toString();
  console.log(`Listening on ${redirectUri}`);
  console.log('Opening browser for Intuit auth...');
  open(authUri);
});
