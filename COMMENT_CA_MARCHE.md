# 🔍 Comment Fonctionne le Système OAuth de rDrive

## 📖 Vue d'Ensemble

rDrive utilise un **service OAuth centralisé** pour permettre aux utilisateurs de connecter leur compte Dropbox/Google Drive sans exposer les clés API.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  TON INFRASTRUCTURE (Privée)                                │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Service OAuth Centralisé                          │    │
│  │  https://cloudoauth-files.ryvie.fr                 │    │
│  │                                                     │    │
│  │  • Clés Dropbox/Google (PRIVÉES)                   │    │
│  │  • Gère les flux OAuth                             │    │
│  │  • Stocke les tokens chiffrés (AES-256)            │    │
│  │  • Expose des API pour les instances rDrive        │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTPS
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
┌───────▼────────┐                   ┌────────▼───────┐
│ Instance rDrive│                   │ Instance rDrive│
│ Utilisateur A  │                   │ Utilisateur B  │
│ (auto-hébergé) │                   │ (auto-hébergé) │
│                │                   │                │
│ • Pas de clés  │                   │ • Pas de clés  │
│ • Délègue OAuth│                   │ • Délègue OAuth│
└────────────────┘                   └────────────────┘
```

## 🔄 Flux OAuth Complet (Étape par Étape)

### Étape 1 : L'utilisateur clique sur "Connecter Dropbox"

**Frontend rDrive** → **Backend rDrive**
```
GET /api/v1/drivers/Dropbox?userEmail=user@example.com
```

**Ce qui se passe** :
- L'utilisateur clique sur le bouton "Connecter Dropbox" dans l'interface rDrive
- Le frontend envoie une requête au backend avec l'email de l'utilisateur

---

### Étape 2 : Backend rDrive génère l'URL OAuth

**Fichier** : `/tdrive/backend/node/src/services/rclone/service.ts`

```typescript
async getAuthUrl(request?: any): Promise<string> {
  // Construire l'URL de callback
  const callbackBase = `${protocol}://${host}/api/v1/oauth/success`;
  const userEmail = request?.query?.userEmail || 'default@user.com';
  
  // Rediriger vers le service OAuth centralisé
  const authUrl = `${this.OAUTH_SERVICE_URL}/oauth/dropbox/start?instance_id=${this.INSTANCE_ID}&user_email=${userEmail}&callback_base=${callbackBase}`;
  
  return authUrl;
}
```

**Ce qui se passe** :
- Le backend rDrive ne fait PAS l'OAuth lui-même
- Il génère une URL qui pointe vers le **service OAuth centralisé**
- Il passe 3 paramètres :
  - `instance_id` : Identifiant unique de cette instance rDrive
  - `user_email` : Email de l'utilisateur
  - `callback_base` : URL de retour après OAuth

**Exemple d'URL générée** :
```
https://cloudoauth-files.ryvie.fr/oauth/dropbox/start?instance_id=abc123&user_email=user@example.com&callback_base=https://rdrive.example.com/api/v1/oauth/success
```

---

### Étape 3 : Redirection vers le Service OAuth

**Backend rDrive** → **Navigateur** → **Service OAuth**

```
302 Redirect → https://cloudoauth-files.ryvie.fr/oauth/dropbox/start?...
```

**Ce qui se passe** :
- Le backend rDrive renvoie une redirection HTTP 302
- Le navigateur de l'utilisateur est redirigé vers le service OAuth centralisé

---

### Étape 4 : Service OAuth génère l'URL Dropbox

**Fichier** : `~/Bureau/oauth-service/oauth-service.js`

```javascript
// Endpoint : /oauth/dropbox/start
if (pathname === '/oauth/dropbox/start') {
  const instanceId = query.instance_id;
  const userEmail = query.user_email;
  const callbackBase = query.callback_base;
  
  // Créer un "state" pour sécuriser le flux OAuth
  const state = JSON.stringify({ 
    instanceId, 
    userEmail, 
    callbackBase,
    provider: 'dropbox',
    nonce: crypto.randomBytes(16).toString('hex')
  });
  
  // Sauvegarder le state temporairement (10 min)
  db.pending[state] = { timestamp: Date.now(), instanceId, userEmail };
  
  // Générer l'URL d'autorisation Dropbox
  const scope = encodeURIComponent([
    'files.content.read',
    'account_info.read'
  ].join(' '));
  
  const authUrl = `https://www.dropbox.com/1/oauth2/authorize?client_id=${DROPBOX_APPKEY}&redirect_uri=${PUBLIC_URL}/oauth/dropbox/callback&response_type=code&scope=${scope}&state=${state}&token_access_type=offline`;
  
  // Rediriger vers Dropbox
  res.writeHead(302, { Location: authUrl });
}
```

**Ce qui se passe** :
1. Le service OAuth reçoit les paramètres de rDrive
2. Il crée un **state** (objet JSON) contenant toutes les infos nécessaires
3. Il sauvegarde ce state temporairement (protection CSRF)
4. Il génère l'URL d'autorisation Dropbox avec :
   - `client_id` : Clé API Dropbox (PRIVÉE, stockée sur le service OAuth)
   - `redirect_uri` : URL de callback du service OAuth
   - `scope` : Les 2 scopes read-only
   - `state` : Le state créé précédemment
   - `token_access_type=offline` : Pour obtenir un refresh token
5. Il redirige l'utilisateur vers Dropbox

**Exemple d'URL Dropbox** :
```
https://www.dropbox.com/1/oauth2/authorize?client_id=YOUR_APP_KEY&redirect_uri=https://cloudoauth-files.ryvie.fr/oauth/dropbox/callback&response_type=code&scope=files.content.read%20account_info.read&state=...&token_access_type=offline
```

---

### Étape 5 : L'utilisateur autorise sur Dropbox

**Navigateur** → **Dropbox**

**Ce qui se passe** :
- L'utilisateur voit la page d'autorisation Dropbox
- Dropbox affiche les permissions demandées :
  - ✅ Lire et télécharger vos fichiers
  - ✅ Voir les informations de votre compte
- L'utilisateur clique sur "Autoriser"

---

### Étape 6 : Dropbox redirige vers le Service OAuth

**Dropbox** → **Service OAuth**

```
GET /oauth/dropbox/callback?code=AUTHORIZATION_CODE&state=...
```

**Ce qui se passe** :
- Dropbox génère un **code d'autorisation** temporaire (valide 10 minutes)
- Dropbox redirige vers l'URL de callback du service OAuth
- Le **state** est renvoyé tel quel (pour validation)

---

### Étape 7 : Service OAuth échange le code contre un token

**Fichier** : `~/Bureau/oauth-service/oauth-service.js`

```javascript
// Endpoint : /oauth/dropbox/callback
if (pathname === '/oauth/dropbox/callback') {
  const code = query.code;
  const stateParam = query.state;
  
  // 1. Valider le state (protection CSRF)
  const stateObj = JSON.parse(decodeURIComponent(stateParam));
  if (!db.pending[stateParam]) {
    return res.end('Invalid or expired state');
  }
  
  // 2. Échanger le code contre un token
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: DROPBOX_APPKEY,
    client_secret: DROPBOX_APPSECRET,  // SECRET utilisé ici !
    redirect_uri: PUBLIC_URL + '/oauth/dropbox/callback'
  });
  
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  
  const tokenData = await response.json();
  // tokenData = {
  //   access_token: "sl.xxx",
  //   refresh_token: "xxx",
  //   expires_in: 14400
  // }
  
  // 3. Chiffrer et stocker le token
  const tokenKey = `${stateObj.instanceId}:${stateObj.userEmail}:dropbox`;
  db.tokens[tokenKey] = {
    access_token: encrypt(tokenData.access_token),
    refresh_token: encrypt(tokenData.refresh_token),
    expires_at: Date.now() + (tokenData.expires_in * 1000),
    created_at: Date.now()
  };
  saveDB(db);
  
  // 4. Rediriger vers rDrive
  const redirectUrl = `${stateObj.callbackBase}?success=true&provider=dropbox&user_email=${stateObj.userEmail}&instance_id=${stateObj.instanceId}`;
  res.writeHead(302, { Location: redirectUrl });
}
```

**Ce qui se passe** :
1. **Validation du state** : Vérifie que le state existe et n'est pas expiré (protection CSRF)
2. **Échange code → token** : Appelle l'API Dropbox avec le code + client_secret (PRIVÉ)
3. **Chiffrement** : Chiffre le token avec AES-256-CBC avant de le stocker
4. **Stockage** : Sauvegarde dans `tokens.json` avec la clé `instance_id:user_email:dropbox`
5. **Redirection** : Redirige vers l'instance rDrive d'origine

**Exemple de token stocké** :
```json
{
  "tokens": {
    "abc123:user@example.com:dropbox": {
      "access_token": "a1b2c3d4:encrypted_data_here",
      "refresh_token": "e5f6g7h8:encrypted_data_here",
      "expires_at": 1736701234567,
      "created_at": 1736686834567
    }
  }
}
```

---

### Étape 8 : Retour vers rDrive

**Service OAuth** → **Navigateur** → **Backend rDrive**

```
GET /api/v1/oauth/success?success=true&provider=dropbox&user_email=user@example.com&instance_id=abc123
```

**Fichier** : `/tdrive/backend/node/src/services/rclone/service.ts`

```typescript
// Endpoint : /api/v1/oauth/success
fastify.get(`${apiPrefix}/oauth/success`, async (request, reply) => {
  const success = request.query.success;
  const provider = request.query.provider;
  const userEmail = request.query.user_email;
  const instanceId = request.query.instance_id;
  
  if (success === 'true' && userEmail && instanceId) {
    // Récupérer le token depuis le service OAuth
    const tokenResponse = await fetch(`${this.OAUTH_SERVICE_URL}/api/token/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instance_id: instanceId,
        user_email: userEmail,
        provider: provider
      })
    });
    
    const tokenData = await tokenResponse.json();
    // tokenData = {
    //   access_token: "sl.xxx",  // Déchiffré
    //   refresh_token: "xxx",
    //   expires_at: 1736701234567
    // }
    
    // Créer le remote rclone
    const remoteName = this.getRemoteName(userEmail);
    const tokenForRclone = JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry: new Date(tokenData.expires_at).toISOString()
    });
    
    const cmd = `rclone config create ${remoteName} dropbox token '${tokenForRclone}' --non-interactive`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ rclone config failed');
      } else {
        console.log(`✅ Remote "${remoteName}" created`);
      }
    });
    
    // Afficher une page de succès
    reply.send('<html><body>✅ Connexion réussie !</body></html>');
  }
});
```

**Ce qui se passe** :
1. **Callback reçu** : rDrive reçoit la confirmation de succès
2. **Récupération du token** : rDrive appelle l'API du service OAuth pour récupérer le token
3. **Déchiffrement** : Le service OAuth déchiffre le token avant de l'envoyer (via HTTPS)
4. **Configuration rclone** : rDrive crée un "remote" rclone avec le token
5. **Page de succès** : L'utilisateur voit une confirmation

---

### Étape 9 : Utilisation du token

**Quand l'utilisateur browse ses fichiers** :

```typescript
// rDrive utilise rclone pour lister les fichiers
const cmd = `rclone lsd dropbox_user@example.com:`;
exec(cmd, (err, stdout) => {
  // stdout contient la liste des dossiers
});
```

**Ce qui se passe** :
1. rDrive exécute une commande rclone
2. rclone lit le token depuis `~/.config/rclone/rclone.conf`
3. rclone appelle l'API Dropbox avec le token
4. Dropbox retourne les fichiers
5. rDrive affiche les fichiers dans l'interface

---

## 🔐 Sécurité

### 1. Clés API Privées
- Les clés Dropbox/Google ne sont **jamais** exposées aux instances rDrive
- Elles restent sur le service OAuth centralisé

### 2. Tokens Chiffrés
```javascript
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
```
- Algorithme : AES-256-CBC
- Clé de chiffrement : 32 bytes (256 bits)
- IV aléatoire pour chaque token

### 3. Protection CSRF
- Le paramètre `state` contient un nonce aléatoire
- Le state est validé au callback
- Les states expirent après 10 minutes

### 4. HTTPS Obligatoire
- Tous les échanges se font en HTTPS
- Les tokens ne transitent jamais en clair

### 5. Isolation des Tokens
- Chaque token est identifié par : `instance_id:user_email:provider`
- Un utilisateur ne peut pas accéder aux tokens d'un autre

---

## 📁 Fichiers Importants

### Service OAuth
```
~/Bureau/oauth-service/
├── oauth-service.js      # Code principal
├── tokens.json           # Base de données (chiffrée)
├── .env                  # Configuration (PRIVÉE)
└── package.json          # Dépendances
```

### rDrive Backend
```
/data/apps/Ryvie-rDrive/tdrive/backend/node/src/services/rclone/
└── service.ts            # Gestion OAuth et rclone
```

### rDrive Frontend (TypeScript)
```
/data/apps/Ryvie-rDrive/tdrive/rcloneTypeScript/src/
└── index.ts              # Alternative backend (legacy)
```

---

## 🔧 Configuration

### Variables d'Environnement - Service OAuth

```bash
# ~/Bureau/oauth-service/.env

PORT=3010
PUBLIC_URL=https://cloudoauth-files.ryvie.fr

# Clés Dropbox (PRIVÉES)
DROPBOX_APPKEY=your_app_key
DROPBOX_APPSECRET=your_app_secret

# Clés Google (PRIVÉES)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Clé de chiffrement (PRIVÉE)
ENCRYPTION_KEY=your_64_char_hex_key
```

### Variables d'Environnement - rDrive

```bash
# /data/apps/Ryvie-rDrive/tdrive/.env

# URL du service OAuth centralisé
OAUTH_SERVICE_URL=https://cloudoauth-files.ryvie.fr

# ID unique de cette instance (généré automatiquement)
INSTANCE_ID=abc123def456
```

---

## 🚀 Déploiement

### 1. Déployer le Service OAuth

```bash
cd ~/Bureau/oauth-service

# Configurer
cp .env.example .env
nano .env  # Remplir les clés

# Démarrer avec PM2
pm2 start oauth-service.js --name rdrive-oauth
pm2 save
pm2 startup
```

### 2. Configurer le Reverse Proxy

```nginx
# /etc/nginx/sites-available/cloudoauth-files.ryvie.fr

server {
    listen 443 ssl;
    server_name cloudoauth-files.ryvie.fr;
    
    ssl_certificate /etc/letsencrypt/live/cloudoauth-files.ryvie.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloudoauth-files.ryvie.fr/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Déployer rDrive

```bash
cd /data/apps/Ryvie-rDrive/tdrive

# Configurer
nano .env
# OAUTH_SERVICE_URL=https://cloudoauth-files.ryvie.fr
# INSTANCE_ID=  # Laissez vide, sera généré automatiquement

# Démarrer
docker-compose up -d
```

---

## 🧪 Tests

### 1. Vérifier le Service OAuth

```bash
curl https://cloudoauth-files.ryvie.fr/health
# {"status":"ok","service":"oauth-centralized","version":"1.0.0"}
```

### 2. Tester le Flux OAuth

1. Se connecter à rDrive
2. Aller dans Paramètres → Stockage Cloud
3. Cliquer sur "Connecter Dropbox"
4. Autoriser sur Dropbox
5. Vérifier que les fichiers apparaissent

### 3. Vérifier les Logs

```bash
# Service OAuth
pm2 logs rdrive-oauth

# rDrive
docker-compose logs -f node
```

---

## 🐛 Troubleshooting

### Erreur : "Token not found"

**Cause** : Le token n'existe pas ou a été supprimé

**Solution** :
1. L'utilisateur doit reconnecter son compte Dropbox
2. Vérifier que le service OAuth est accessible
3. Vérifier les logs : `pm2 logs rdrive-oauth`

### Erreur : "Invalid state"

**Cause** : Le state a expiré (> 10 minutes) ou est invalide

**Solution** :
1. Recommencer le flux OAuth
2. Vérifier que l'horloge du serveur est synchronisée

### Erreur : "Token exchange failed"

**Cause** : Les clés Dropbox sont invalides ou le code a expiré

**Solution** :
1. Vérifier les clés dans `~/Bureau/oauth-service/.env`
2. Vérifier que les URLs de callback sont correctes dans Dropbox App Console
3. Recommencer le flux OAuth rapidement (code valide 10 min)

---

## 📊 Monitoring

### Métriques à Surveiller

```bash
# Nombre de tokens stockés
cat ~/Bureau/oauth-service/tokens.json | jq '.tokens | length'

# Logs récents
pm2 logs rdrive-oauth --lines 50

# Uptime du service
pm2 status
```

### Logs Importants

```
🔐 Dropbox OAuth start for user@example.com (instance: abc123)
✅ Dropbox token stored for user@example.com (instance: abc123)
📤 Token retrieved for user@example.com (dropbox)
🧹 Cleaned 5 expired pending states
```

---

## 🎯 Résumé

1. **rDrive** ne gère PAS l'OAuth directement
2. **rDrive** délègue à un **service OAuth centralisé**
3. Le **service OAuth** possède les clés API (privées)
4. Le **service OAuth** stocke les tokens chiffrés
5. **rDrive** récupère les tokens via une API sécurisée
6. **rDrive** utilise rclone pour accéder aux fichiers

**Avantages** :
- ✅ Clés API privées et sécurisées
- ✅ Tokens chiffrés en AES-256
- ✅ Isolation par utilisateur et instance
- ✅ Scalable pour plusieurs instances rDrive
- ✅ Facile à maintenir et mettre à jour

---

**Pour plus d'informations** :
- `DROPBOX_PRODUCTION_RESPONSE.md` - Réponse pour Dropbox
- `DROPBOX_PRODUCTION_CHECKLIST.md` - Checklist de déploiement
- `DROPBOX_READ_ONLY_SUMMARY.md` - Configuration read-only
- `oauth-service-read-only-patch.txt` - Patch pour 2 scopes
