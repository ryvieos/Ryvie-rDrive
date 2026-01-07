# Migration OAuth - Service Centralisé

## 🎯 Objectif

rDrive utilise maintenant un service OAuth centralisé pour gérer les authentifications Dropbox et Google Drive. Cela permet de :
- ✅ Garder les clés API privées sur l'infrastructure Ryvie
- ✅ Simplifier l'installation pour les utilisateurs
- ✅ Éviter que chaque utilisateur doive créer ses propres applications OAuth
- ✅ Améliorer la sécurité (tokens chiffrés, pas d'exposition des secrets)

## 📋 Changements

### Avant
```env
DROPBOX_APPKEY=xxx
DROPBOX_APPSECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
```

### Après
```env
OAUTH_SERVICE_URL=https://cloudoauth-files.ryvie.fr
INSTANCE_ID=  # Généré automatiquement
```

## 🚀 Migration pour les instances existantes

### 1. Mettre à jour le `.env`

Supprimer les anciennes variables :
```bash
cd /data/apps/Ryvie-rDrive/tdrive
nano .env
```

Supprimer ces lignes :
```
DROPBOX_APPKEY=...
DROPBOX_APPSECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OAUTH_PROXY=...
```

Ajouter :
```
OAUTH_SERVICE_URL=https://cloudoauth-files.ryvie.fr
INSTANCE_ID=
```

### 2. Redémarrer les services

```bash
docker-compose down
docker-compose up -d
```

### 3. Reconnecter vos comptes

Les utilisateurs devront reconnecter leurs comptes Dropbox/Google Drive via l'interface rDrive.

**Note :** Les anciens tokens rclone locaux continueront de fonctionner temporairement, mais il est recommandé de reconnecter pour bénéficier du nouveau système.

## 🔧 Pour les développeurs

### Architecture

```
┌─────────────────┐
│  rDrive Frontend│
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────────┐
│  rDrive Backend │─────▶│ OAuth Service        │
│  (Instance)     │      │ (cloudoauth-files)   │
└─────────────────┘      └──────────┬───────────┘
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  ┌─────────────┐      ┌─────────────┐
                  │  Dropbox    │      │   Google    │
                  │  OAuth      │      │   OAuth     │
                  └─────────────┘      └─────────────┘
```

### Flux OAuth

1. **Utilisateur clique sur "Connecter Dropbox"**
   - Frontend → Backend `/api/v1/drivers/Dropbox?userEmail=xxx`
   
2. **Backend génère l'URL OAuth**
   - Backend → Service OAuth `/oauth/dropbox/start?instance_id=xxx&user_email=xxx&callback_base=xxx`
   
3. **Service OAuth redirige vers Dropbox**
   - Service OAuth → Dropbox OAuth
   
4. **Dropbox callback**
   - Dropbox → Service OAuth `/oauth/dropbox/callback?code=xxx`
   
5. **Service OAuth échange le code**
   - Service OAuth stocke le token chiffré
   - Service OAuth → Backend callback `/api/v1/oauth/success?success=true&provider=dropbox`
   
6. **Backend redirige vers le frontend**
   - Backend → Frontend `/client`

### Récupération des tokens

Quand rDrive a besoin d'accéder à Dropbox/Google :

```typescript
const response = await fetch('https://cloudoauth-files.ryvie.fr/api/token/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instance_id: process.env.INSTANCE_ID,
    user_email: 'user@example.com',
    provider: 'dropbox'
  })
});

const { access_token, refresh_token } = await response.json();
```

## 🔒 Sécurité

- Les tokens sont chiffrés en AES-256-CBC
- Les clés API ne sont jamais exposées au frontend
- Validation CSRF via le paramètre `state`
- Nettoyage automatique des états expirés
- Rate limiting sur le service OAuth

## 📞 Support

Si vous rencontrez des problèmes :
1. Vérifiez que `OAUTH_SERVICE_URL` est correct
2. Vérifiez les logs : `docker-compose logs -f node`
3. Testez le service OAuth : `curl https://cloudoauth-files.ryvie.fr/health`
4. Ouvrez une issue : https://github.com/Ryvie/rDrive/issues

## 🔄 Rollback (si nécessaire)

Si vous devez revenir à l'ancien système :

1. Restaurer les clés dans `.env` :
```env
DROPBOX_APPKEY=xxx
DROPBOX_APPSECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
```

2. Modifier `docker-compose.yml` pour réinjecter ces variables

3. Redémarrer : `docker-compose restart node`

**Note :** Le rollback n'est pas recommandé car l'ancien système expose vos clés.
