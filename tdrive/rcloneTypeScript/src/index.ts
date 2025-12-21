import express, { Request, Response } from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { exec } from 'child_process';
import fetch from 'node-fetch';  // npm install node-fetch @types/node-fetch

// Extend express-session to include Dropbox credentials
interface DropboxSession {
  access_token: string;
  refresh_token: string;
  expiry: string;
}

declare module 'express-session' {
  interface SessionData {
    dropbox?: DropboxSession;
  }
}

// OAuth token response interface
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

// List folder response interface
interface ListFolderResponse {
  entries: any[];
}

const app = express();
const PORT = 3010;
const REMOTE_NAME = 'test4';

// Config
const PROXY = process.env.OAUTH_PROXY || 'https://cloudoauth-files.ryvie.fr';
const DROPBOX_APPKEY = '4b5q5772012fqnf';
const DROPBOX_APPSECRET = 'obtjnollfq4j5ck';

// 1) CORS + static files + session
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'change_me', resave: false, saveUninitialized: true }));

// 2) Root -> index.html
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3) Generate AuthUrl for Dropbox OAuth
app.get('/v1/drivers/Dropbox', (req: Request, res: Response) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const callbackBase = `${protocol}://${host}/v1/recover/Dropbox`;

  const redirectUri = encodeURIComponent(PROXY);
  const state = encodeURIComponent(callbackBase);
  const scope = encodeURIComponent([
    'files.metadata.write',
    'files.content.write',
    'files.content.read',
    'sharing.write',
    'account_info.read'
  ].join(' '));

  const authUrl = [
    'https://www.dropbox.com/1/oauth2/authorize',
    `client_id=${DROPBOX_APPKEY}`,
    `redirect_uri=${redirectUri}`,
    'response_type=code',
    `scope=${scope}`,
    `state=${state}`,
    'token_access_type=offline'
  ].join('&').replace('authorize&', 'authorize?');

  console.log('→ AuthUrl generated:', authUrl);
  res.json({ addition: { AuthUrl: authUrl } });
});

// 4) OAuth callback
app.get('/v1/recover/Dropbox', async (req: Request, res: Response) => {
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  console.log('🔔 Callback received:', fullUrl);

  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('❌ Missing code');
  }

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: DROPBOX_APPKEY,
    client_secret: DROPBOX_APPSECRET,
    redirect_uri: PROXY
  });

  try {
    const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const tokenJson = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok) {
      console.error('Token error:', tokenJson);
      return res.status(500).send('Token exchange failed');
    }

    // Store in session
    req.session.dropbox = {
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expiry: tokenJson.expires_at
    };
    console.log('✅ Tokens stored in session');

    // Create rclone remote
    const tokenForRclone = JSON.stringify({
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expiry: tokenJson.expires_at
    });
    const cmd = `rclone config create ${REMOTE_NAME} dropbox token '${tokenForRclone}' --non-interactive`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) console.error('rclone config failed:', stderr);
      else console.log(`✅ Remote "${REMOTE_NAME}" created in rclone.conf`);
    });

    res.send('✅ Authentication successful! You may close this window.');
  } catch (error) {
    console.error('Exchange error:', error);
    res.status(500).send('Internal OAuth error');
  }
});

// 5) List files
app.get('/v1/files/list', async (req: Request, res: Response) => {
  const creds = req.session.dropbox;
  if (!creds) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: (req.query.path as string) || '' })
    });
    const data = (await listRes.json()) as ListFolderResponse;
    if (!listRes.ok) {
      console.error('List error:', data);
      return res.status(500).json({ error: 'Listing failed' });
    }
    res.json(data.entries);
  } catch (error) {
    console.error('Listing exception:', error);
    res.status(500).json({ error: 'Internal listing error' });
  }
});

// 6) Start server
app.listen(PORT, () => {
  console.log(`🚀 OAuth service running on http://0.0.0.0:${PORT}`);
  console.log(`→ Frontend:       http://<VM_IP>:${PORT}/`);
  console.log(`→ Auth route:     /v1/drivers/Dropbox`);
  console.log(`→ Callback route: /v1/recover/Dropbox`);
  console.log(`→ List files:     /v1/files/list`);
});
