# 🚀 Guide de Démarrage Rapide - Service OAuth Centralisé

## ✅ Ce qui a été fait

1. **Service OAuth centralisé créé** dans `/oauth-service/`
   - Gère l'authentification Dropbox et Google Drive
   - Stocke les tokens de manière chiffrée (AES-256)
   - Expose des API pour les instances rDrive

2. **Backend rDrive modifié** pour utiliser le service centralisé
   - Plus besoin de clés OAuth dans chaque instance
   - Redirection automatique vers le service centralisé
   - Nouveau endpoint `/api/v1/oauth/success` pour les callbacks

3. **Configuration simplifiée**
   - `.env.example` mis à jour
   - `docker-compose.yml` modifié
   - Documentation complète fournie

## 🎯 Prochaines étapes

### Étape 1 : Régénérer les clés OAuth (IMPORTANT)

Les anciennes clés sont compromises. Créez-en de nouvelles :

**Dropbox :**
1. Aller sur https://www.dropbox.com/developers/apps
2. Créer une nouvelle app ou régénérer les clés
3. Configurer le Redirect URI : `https://cloudoauth-files.ryvie.fr/oauth/dropbox/callback`
4. Noter le App Key et App Secret

**Google Drive :**
1. Aller sur https://console.cloud.google.com/apis/credentials
2. Créer un nouveau OAuth 2.0 Client ID ou régénérer
3. Configurer le Redirect URI : `https://cloudoauth-files.ryvie.fr/oauth/google/callback`
4. Noter le Client ID et Client Secret

### Étape 2 : Déployer le service OAuth

```bash
cd /data/apps/Ryvie-rDrive/oauth-service

# Configurer les variables
cp .env.example .env
nano .env
```

Remplir avec vos nouvelles clés :
```env
PORT=3010
PUBLIC_URL=https://cloudoauth-files.ryvie.fr
DROPBOX_APPKEY=vos_nouvelles_clés
DROPBOX_APPSECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Démarrer le service :
```bash
# Option 1 : Direct
node oauth-service.js

# Option 2 : PM2 (recommandé)
npm install -g pm2
pm2 start oauth-service.js --name rdrive-oauth
pm2 save

# Option 3 : Docker
docker build -t rdrive-oauth .
docker run -d --name rdrive-oauth -p 3010:3010 --env-file .env rdrive-oauth
```

### Étape 3 : Configurer le reverse proxy

Assurez-vous que `https://cloudoauth-files.ryvie.fr` pointe vers le service OAuth (port 3010).

Exemple Nginx :
```nginx
server {
    listen 443 ssl;
    server_name cloudoauth-files.ryvie.fr;
    
    ssl_certificate /etc/letsencrypt/live/cloudoauth-files.ryvie.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloudoauth-files.ryvie.fr/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Étape 4 : Mettre à jour les instances rDrive

```bash
cd /data/apps/Ryvie-rDrive/tdrive

# Mettre à jour .env
nano .env
```

Supprimer :
```
DROPBOX_APPKEY=...
DROPBOX_APPSECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Ajouter :
```
OAUTH_SERVICE_URL=https://cloudoauth-files.ryvie.fr
INSTANCE_ID=
```

Redémarrer :
```bash
docker-compose down
docker-compose up -d
```

### Étape 5 : Tester

```bash
# Vérifier le service OAuth
curl https://cloudoauth-files.ryvie.fr/health

# Vérifier les logs
pm2 logs rdrive-oauth
# ou
docker logs -f rdrive-oauth

# Tester l'authentification depuis l'interface rDrive
# 1. Se connecter à rDrive
# 2. Aller dans les paramètres
# 3. Cliquer sur "Connecter Dropbox" ou "Connecter Google Drive"
# 4. Suivre le flux OAuth
```

## 📁 Structure des fichiers créés

```
/data/apps/Ryvie-rDrive/
├── oauth-service/                    # Nouveau service OAuth
│   ├── oauth-service.js              # Code principal
│   ├── package.json                  # Dépendances
│   ├── .env.example                  # Template de configuration
│   ├── .gitignore                    # Fichiers à ignorer
│   ├── README.md                     # Documentation
│   ├── DEPLOYMENT.md                 # Guide de déploiement
│   ├── Dockerfile                    # Image Docker
│   └── .dockerignore                 # Fichiers Docker à ignorer
│
├── tdrive/
│   ├── .env.example                  # Mis à jour (sans clés OAuth)
│   ├── docker-compose.yml            # Modifié (utilise OAUTH_SERVICE_URL)
│   └── backend/node/src/services/rclone/service.ts  # Modifié
│
├── OAUTH_MIGRATION.md                # Guide de migration
└── QUICK_START_OAUTH.md              # Ce fichier
```

## 🔒 Sécurité

### ✅ Avantages du nouveau système

- Les clés API restent privées sur votre infrastructure
- Tokens chiffrés en AES-256-CBC
- Validation CSRF via le paramètre `state`
- Nettoyage automatique des états expirés
- Pas d'exposition des secrets au frontend

### ⚠️ Points d'attention

1. **Sauvegardez la clé de chiffrement** : Si perdue, les tokens ne pourront plus être déchiffrés
2. **HTTPS obligatoire** : Le service doit être accessible uniquement en HTTPS
3. **Monitoring** : Surveillez les logs pour détecter les anomalies
4. **Backups** : Sauvegardez régulièrement `tokens.json`
5. **Rate limiting** : Configurez un rate limit sur votre reverse proxy

## 📊 Monitoring

### Logs à surveiller

```bash
# Service OAuth
pm2 logs rdrive-oauth

# Backend rDrive
docker-compose logs -f node
```

### Métriques importantes

- Nombre de flux OAuth démarrés
- Taux de succès des échanges de tokens
- Erreurs 4xx/5xx
- Latence des endpoints

## 🐛 Troubleshooting

### Le service OAuth ne démarre pas

```bash
# Vérifier les variables d'environnement
cat .env

# Vérifier que toutes les clés sont présentes
env | grep -E "DROPBOX|GOOGLE|ENCRYPTION"
```

### Les utilisateurs ne peuvent pas se connecter

```bash
# Vérifier que le service est accessible
curl https://cloudoauth-files.ryvie.fr/health

# Vérifier les URLs de callback dans Dropbox/Google
# Elles doivent pointer vers https://cloudoauth-files.ryvie.fr/oauth/.../callback
```

### Erreur "Token not found"

L'utilisateur doit reconnecter son compte via l'interface rDrive.

## 📞 Support

- Documentation complète : `/oauth-service/README.md`
- Guide de déploiement : `/oauth-service/DEPLOYMENT.md`
- Guide de migration : `/OAUTH_MIGRATION.md`
- Issues GitHub : https://github.com/Ryvie/rDrive/issues

## 🎉 C'est tout !

Une fois ces étapes complétées :
- ✅ Vos clés OAuth sont sécurisées
- ✅ Les utilisateurs peuvent se connecter à Dropbox/Google Drive
- ✅ Chaque instance rDrive est isolée
- ✅ Le système est prêt pour la production

**Note :** Les utilisateurs existants devront reconnecter leurs comptes Dropbox/Google Drive après la migration.
