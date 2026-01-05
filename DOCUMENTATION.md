# Documentation rDrive

## Table des matières

1. [Architecture](#architecture)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Stockage des données](#stockage-des-données)
5. [OnlyOffice Integration](#onlyoffice-integration)
6. [Réseau et accès](#réseau-et-accès)
7. [Maintenance](#maintenance)
8. [Dépannage](#dépannage)
9. [Backup et restauration](#backup-et-restauration)
10. [Sécurité](#sécurité)

---

## Architecture

### Vue d'ensemble

rDrive est une solution de stockage cloud auto-hébergée basée sur une architecture microservices avec Docker.

```
┌─────────────────────────────────────────────────────────┐
│                    Client Browser                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Nginx)                                │
│  Port: 3010 (HTTP) / 8443 (HTTPS)                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│  Backend (Node.js + Express)                             │
│  Port: 4000 (API + WebSocket)                           │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
┌──────────┐  ┌──────────┐  ┌──────────────────┐
│ MongoDB  │  │OnlyOffice│  │OnlyOffice        │
│ Port:    │  │Connector │  │Document Server   │
│ 27017    │  │Port: 5000│  │Port: 8090        │
└──────────┘  └──────────┘  └──────────────────┘
                     │              │
                     └──────┬───────┘
                            ↓
                    ┌──────────────┐
                    │ PostgreSQL   │
                    │ (OnlyOffice) │
                    │ Port: 5433   │
                    └──────────────┘
```

### Stack technique

| Composant | Technologie | Version | Rôle |
|-----------|-------------|---------|------|
| **Frontend** | React + TypeScript | Latest | Interface utilisateur |
| **Backend** | Node.js + Express | LTS | API REST + WebSocket |
| **Base de données** | MongoDB | Latest | Métadonnées des fichiers |
| **Stockage** | Filesystem local | - | Données binaires |
| **Éditeur** | OnlyOffice Document Server | 9.2.1 | Édition collaborative |
| **Connecteur** | OnlyOffice Connector | 1.0.0 | Pont OnlyOffice ↔ Backend |
| **Queue** | RabbitMQ | Latest | Queue OnlyOffice |
| **DB OnlyOffice** | PostgreSQL | 13 | Base OnlyOffice |
| **Reverse Proxy** | Nginx | Latest | Serveur web frontend |
| **VPN** | NetBird (WireGuard) | Latest | Accès distant sécurisé |

---

## Installation

### Prérequis

- **OS** : Linux (Ubuntu 20.04+ recommandé)
- **Docker** : 20.10+
- **Docker Compose** : 2.0+
- **RAM** : 4 GB minimum (8 GB recommandé)
- **Disque** : 20 GB minimum
- **Ports libres** : 3010, 4000, 5000, 8090, 27017, 5433, 5672, 15672

### Installation rapide

```bash
# 1. Cloner le repository
git clone https://github.com/maisonnavejul/Ryvie-rDrive.git
cd Ryvie-rDrive/tdrive

# 2. Copier et configurer l'environnement
cp .env.example .env
nano .env

# 3. Démarrer tous les services
docker compose up -d

# 4. Vérifier que tous les services sont démarrés
docker compose ps
```

### Installation avec NetBird (accès distant)

```bash
# 1. Installer NetBird
curl -fsSL https://pkgs.netbird.io/install.sh | sh

# 2. Configurer NetBird
sudo netbird up

# 3. Noter l'IP NetBird
ip addr show wt0

# 4. Configurer le .env avec l'IP NetBird
nano .env
```

---

## Configuration

### Fichier `.env`

Le fichier `.env` contient toutes les variables d'environnement nécessaires.

#### Configuration réseau

```bash
# URLs publiques (pour accès remote via NetBird ou domaine)
REACT_APP_FRONTEND_URL=http://<PUBLIC_HOSTNAME_OR_IP>:3010
REACT_APP_BACKEND_URL=http://<PUBLIC_HOSTNAME_OR_IP>:4000
REACT_APP_WEBSOCKET_URL=ws://<PUBLIC_HOSTNAME_OR_IP>:4000/ws
REACT_APP_ONLYOFFICE_CONNECTOR_URL=http://<PUBLIC_HOSTNAME_OR_IP>:5000
REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL=http://<PUBLIC_HOSTNAME_OR_IP>:8090

# IP/DNS privée pour détection locale
REACT_APP_FRONTEND_URL_PRIVATE=<PRIVATE_HOSTNAME_OR_IP>
```

**Explication** :
- `REACT_APP_*` : Variables injectées dans le frontend React au build
- `<PUBLIC_HOSTNAME_OR_IP>` : Adresse publique (NetBird, domaine DNS, IP statique…)
- `<PRIVATE_HOSTNAME_OR_IP>` : Adresse locale (LAN) utilisée par les clients internes

#### Configuration authentification

```bash
# LDAP (optionnel)
LDAP_BIND_PASSWORD=votre_mot_de_passe_securise

# OAuth Dropbox (optionnel)
DROPBOX_APPKEY=votre_dropbox_key
DROPBOX_APPSECRET=votre_dropbox_secret

# OAuth Google (optionnel)
GOOGLE_CLIENT_ID=votre_google_client_id
GOOGLE_CLIENT_SECRET=votre_google_client_secret
```

### Configuration OnlyOffice

Le connecteur OnlyOffice est configuré dans `docker-compose.yml` :

```yaml
onlyoffice-connector:
  environment:
    - SERVER_PORT=5000
    - SERVER_PREFIX=/plugins/onlyoffice/
    - SERVER_ORIGIN=${REACT_APP_ONLYOFFICE_CONNECTOR_URL}
    - CREDENTIALS_ENDPOINT=http://localhost:4000/
    - ONLY_OFFICE_SERVER=http://localhost:8090/
    - CREDENTIALS_ID=tdrive_onlyoffice
    - CREDENTIALS_SECRET=c1cc66db78e1d3bb4713c55d5ab2
  network_mode: host
```

**Points importants** :
- `CREDENTIALS_ENDPOINT` et `ONLY_OFFICE_SERVER` utilisent `localhost` car le connecteur est en mode `host`
- Cela permet au connecteur d'accéder aux services même si NetBird est arrêté
- `SERVER_ORIGIN` utilise la variable d'environnement pour l'accès client

---

## Stockage des données

### Architecture de stockage

rDrive utilise une **architecture hybride** :

1. **Métadonnées** → MongoDB
2. **Données binaires** → Filesystem

### Emplacement physique

```
/data/apps/Ryvie-rDrive/tdrive/docker-data/
├── files/                    # Fichiers utilisateurs
│   └── tdrive/files/
│       └── [company_id]/
│           └── [user_id]/
│               └── [file_id]/
│                   ├── chunk1           # Données binaires
│                   └── thumbnails/
│                       └── 0.png        # Miniature
├── mongo/                    # Base MongoDB
├── onlyoffice/              # Données OnlyOffice
│   ├── Data/
│   ├── lib/
│   └── log/
├── onlyoffice-postgres/     # Base PostgreSQL OnlyOffice
├── rabbitmq/                # Queue RabbitMQ
└── logs/                    # Logs Nginx
```

### Structure MongoDB

#### Collection `applications`

Enregistre les applications tierces (OnlyOffice, etc.) :

```json
{
  "id": "tdrive_onlyoffice",
  "internal_domain": "tdrive_onlyoffice",
  "company_id": "tdrive",
  "is_default": true,
  "identity": {
    "code": "tdrive_onlyoffice",
    "name": "OnlyOffice",
    "description": "OnlyOffice Document Editor"
  },
  "access": {
    "privileges": ["*"]
  },
  "display": {
    "tdrive": {
      "files": {
        "preview": {
          "url": "http://localhost:5000/plugins/onlyoffice?preview=1",
          "edition_url": "http://localhost:5000/plugins/onlyoffice"
        }
      }
    }
  }
}
```

#### Collection `drive_files`

Métadonnées des fichiers :

```json
{
  "id": "91cf11af-0277-42a8-9fb6-ac6b05caffcb",
  "name": "document.xlsx",
  "extension": "xlsx",
  "size": 21747,
  "creator": "2b51a1d0-de77-11f0-b6a0-47e2f4bdf7b4",
  "company_id": "2b4daa30-de77-11f0-b6a0-47e2f4bdf7b4",
  "parent_id": "75806fe7-76a6-413c-8acd-49bfdee0fc84",
  "last_version_cache": {
    "file_metadata": {
      "external_id": "619285a5-ea6f-4d11-80bf-b4115b132b4d",
      "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "size": 21747
    }
  }
}
```

**Lien avec filesystem** :
- `external_id` → Nom du dossier dans `docker-data/files/`
- Les données binaires sont dans `[external_id]/chunk1`

---

## OnlyOffice Integration

### Architecture OnlyOffice

```
Browser
   ↓
Frontend → OnlyOffice Connector → OnlyOffice Document Server
              ↓                           ↓
           Backend                   PostgreSQL
              ↓
          MongoDB
```

### Flux d'édition

1. **Ouverture d'un fichier** :
   ```
   User clique sur fichier
   → Frontend demande token au Backend
   → Backend crée editing_session_key
   → Frontend redirige vers OnlyOffice Connector
   → Connector génère page HTML avec OnlyOffice API
   → OnlyOffice Document Server télécharge le fichier via Connector
   → Document s'affiche dans le navigateur
   ```

2. **Sauvegarde** :
   ```
   User modifie le document
   → OnlyOffice envoie callback au Connector
   → Connector télécharge la nouvelle version depuis OnlyOffice
   → Connector upload vers Backend
   → Backend sauvegarde dans filesystem + met à jour MongoDB
   ```

### Configuration réseau OnlyOffice

Le connecteur détecte automatiquement l'origine de la requête et adapte les URLs :

```typescript
// Dans browser-editor.controller.ts
const hostname = req.get('host').split(':')[0];

// Accès local (10.x, 192.168.x, localhost)
if (isLocal(hostname)) {
  connectorServerUrl = `http://${PRIVATE_HOSTNAME_OR_IP}:5000/plugins/onlyoffice/`;
  onlyofficeServerUrl = `http://${PRIVATE_HOSTNAME_OR_IP}:8090/`;
}
// Accès remote (NetBird, domaine, IP publique)
else {
  connectorServerUrl = `http://${PUBLIC_HOSTNAME_OR_IP}:5000/plugins/onlyoffice/`;
  onlyofficeServerUrl = `http://${PUBLIC_HOSTNAME_OR_IP}:8090/`;
}
```

### Enregistrement de l'application OnlyOffice

**Important** : L'application doit être enregistrée dans MongoDB pour fonctionner.

```bash
# Vérifier si l'application existe
docker exec app-rdrive-node node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect('mongodb://mongo:27017');
  const db = client.db('tdrive');
  const apps = await db.collection('applications').find({id: 'tdrive_onlyoffice'}).toArray();
  console.log(apps.length > 0 ? '✅ Application enregistrée' : '❌ Application manquante');
  await client.close();
})()
"

# Si manquante, l'ajouter (voir section Dépannage)
```

---

## Réseau et accès

### Mode d'accès automatique

Le frontend détecte automatiquement le mode d'accès :

```javascript
// frontend/public/config.js
const hostname = window.location.hostname;
const isLocal = hostname === 'localhost' ||
                hostname === 'ryvie.local' ||
                hostname.startsWith('10.') ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('172.');

if (isLocal) {
  // Mode local : utilise IP locale
  window.APP_CONFIG = {
    BACKEND_URL: `http://${PRIVATE_HOSTNAME_OR_IP}:4000`,
    // ...
  };
} else {
  // Mode remote : utilise l'IP/DNS publique
  window.APP_CONFIG = {
    BACKEND_URL: `http://${PUBLIC_HOSTNAME_OR_IP}:4000`,
    // ...
  };
}
```

### Accès local (réseau privé)

**URL** : `http://<PRIVATE_HOSTNAME_OR_IP>:3010`

**Configuration** :
- Pas besoin de NetBird
- Accès direct via IP locale
- Tous les services communiquent via le réseau local

### Accès distant (via NetBird)

**URL** : `http://<PUBLIC_HOSTNAME_OR_IP>:3010`

**Prérequis** :
- NetBird installé et actif sur le client
- NetBird actif sur le serveur

**Commandes NetBird** :
```bash
# Démarrer NetBird
sudo systemctl start netbird

# Arrêter NetBird
sudo systemctl stop netbird

# Statut
sudo systemctl status netbird

# Voir l'IP NetBird
ip addr show wt0
```

### Ports utilisés

| Service | Port | Protocole | Exposition |
|---------|------|-----------|------------|
| Frontend | 3010 | HTTP | Externe |
| Frontend SSL | 8443 | HTTPS | Externe |
| Backend API | 4000 | HTTP/WS | Externe |
| OnlyOffice Connector | 5000 | HTTP | Externe |
| OnlyOffice Server | 8090 | HTTP | Externe |
| MongoDB | 27017 | TCP | Interne |
| PostgreSQL | 5433 | TCP | Interne |
| RabbitMQ | 5672 | TCP | Interne |
| RabbitMQ Management | 15672 | HTTP | Interne |

---

## Maintenance

### Commandes Docker

```bash
# Démarrer tous les services
docker compose up -d

# Arrêter tous les services
docker compose down

# Redémarrer un service spécifique
docker compose restart frontend
docker compose restart node
docker compose restart onlyoffice-connector

# Voir les logs
docker compose logs -f
docker compose logs -f frontend
docker compose logs -f node

# Voir l'état des services
docker compose ps

# Rebuild un service
docker compose up -d --build frontend
docker compose up -d --build onlyoffice-connector
```

### Mise à jour

```bash
# 1. Sauvegarder les données (voir section Backup)

# 2. Arrêter les services
docker compose down

# 3. Mettre à jour le code
git pull origin main

# 4. Rebuild les images
docker compose build

# 5. Redémarrer
docker compose up -d

# 6. Vérifier les logs
docker compose logs -f
```

### Nettoyage

```bash
# Supprimer les images inutilisées
docker image prune -a

# Supprimer les volumes inutilisés
docker volume prune

# Supprimer les conteneurs arrêtés
docker container prune

# Nettoyage complet (attention !)
docker system prune -a --volumes
```

### Monitoring

```bash
# Utilisation CPU/RAM des conteneurs
docker stats

# Espace disque
df -h
du -sh docker-data/*

# Logs système
journalctl -u docker -f

# Santé des services
curl http://localhost:4000/diagnostics/t/ready?secret=diag-secret
```

---

## Dépannage

### OnlyOffice ne charge pas les fichiers

**Symptôme** : "Chargement d'une feuille de calcul" infini ou "Échec du téléchargement"

**Causes possibles** :

1. **Application OnlyOffice non enregistrée**

```bash
# Vérifier
docker exec app-rdrive-node node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect('mongodb://mongo:27017');
  const db = client.db('tdrive');
  const apps = await db.collection('applications').find({}).toArray();
  console.log(JSON.stringify(apps, null, 2));
  await client.close();
})()
"

# Si vide, ajouter l'application
docker exec app-rdrive-node node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect('mongodb://mongo:27017');
  const db = client.db('tdrive');
  
  const app = {
    id: 'tdrive_onlyoffice',
    internal_domain: 'tdrive_onlyoffice',
    external_domain: '',
    company_id: 'tdrive',
    is_default: true,
    identity: {
      code: 'tdrive_onlyoffice',
      name: 'OnlyOffice',
      icon: '',
      description: 'OnlyOffice Document Editor',
      website: '',
      categories: [],
      compatibility: [],
      repository: ''
    },
    api: {
      hooks: [],
      allowed_ips: []
    },
    access: {
      privileges: ['*']
    },
    display: {
      tdrive: {
        version: 1,
        files: {
          preview: {
            url: 'http://localhost:5000/plugins/onlyoffice?preview=1',
            edition_url: 'http://localhost:5000/plugins/onlyoffice'
          }
        }
      }
    },
    stats: {
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1
    },
    publication: {
      published: false,
      requested: false
    }
  };
  
  await db.collection('applications').insertOne(app);
  console.log('✅ Application OnlyOffice enregistrée');
  await client.close();
})()
"

# Redémarrer le connecteur
docker compose restart onlyoffice-connector
```

2. **Connecteur ne peut pas atteindre le backend**

```bash
# Vérifier les logs
docker logs app-rdrive-onlyoffice-connector --tail 50 | grep -i error

# Tester la connexion
curl http://localhost:4000/diagnostics/t/ready?secret=diag-secret

# Vérifier que le backend écoute sur 0.0.0.0
docker exec app-rdrive-node netstat -tlnp | grep 4000
```

3. **OnlyOffice Document Server ne peut pas télécharger le fichier**

```bash
# Vérifier les logs OnlyOffice
docker logs app-rdrive-onlyoffice --tail 100 | grep -i error

# Vérifier la connectivité
docker exec app-rdrive-onlyoffice curl -I http://10.128.255.101:5000/plugins/onlyoffice/
```

### Backend ne démarre pas

```bash
# Voir les logs
docker logs app-rdrive-node --tail 100

# Vérifier MongoDB
docker logs app-rdrive-mongo --tail 50

# Tester la connexion MongoDB
docker exec app-rdrive-node node -e "
const { MongoClient } = require('mongodb');
MongoClient.connect('mongodb://mongo:27017')
  .then(() => console.log('✅ MongoDB OK'))
  .catch(err => console.error('❌ MongoDB erreur:', err))
"
```

### Frontend ne se charge pas

```bash
# Vérifier les logs Nginx
docker logs app-rdrive-frontend --tail 50

# Vérifier les fichiers buildés
docker exec app-rdrive-frontend ls -la /tdrive-react/build/

# Tester Nginx
docker exec app-rdrive-frontend nginx -t
```

### NetBird ne fonctionne pas

```bash
# Statut
sudo systemctl status netbird

# Logs
sudo journalctl -u netbird -f

# Redémarrer
sudo systemctl restart netbird

# Vérifier l'interface
ip addr show wt0

# Tester la connectivité
ping <PUBLIC_HOSTNAME_OR_IP>
```

### Erreur "ECONNREFUSED"

**Cause** : Un service essaie de se connecter à un autre service qui n'est pas accessible.

**Solutions** :
1. Vérifier que tous les services sont démarrés : `docker compose ps`
2. Vérifier les logs du service qui échoue
3. Vérifier la configuration réseau (`network_mode`, `networks`)
4. Redémarrer les services dans l'ordre : MongoDB → Backend → Connecteur → Frontend

---

## Backup et restauration

### Backup complet

```bash
#!/bin/bash
# backup-rdrive.sh

BACKUP_DIR="/backup/rdrive-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1. Backup fichiers
echo "📁 Backup fichiers..."
tar -czf "$BACKUP_DIR/files.tar.gz" docker-data/files/

# 2. Backup MongoDB
echo "💾 Backup MongoDB..."
docker exec app-rdrive-mongo mongodump --out=/backup
docker cp app-rdrive-mongo:/backup "$BACKUP_DIR/mongodb"

# 3. Backup PostgreSQL (OnlyOffice)
echo "🗄️ Backup PostgreSQL..."
docker exec app-rdrive-postgresql pg_dump -U onlyoffice onlyoffice > "$BACKUP_DIR/postgres.sql"

# 4. Backup configuration
echo "⚙️ Backup configuration..."
cp .env "$BACKUP_DIR/"
cp docker-compose.yml "$BACKUP_DIR/"
cp docker-compose.dev.yml "$BACKUP_DIR/"

# 5. Compression finale
echo "📦 Compression..."
cd /backup
tar -czf "rdrive-backup-$(date +%Y%m%d-%H%M%S).tar.gz" "$(basename $BACKUP_DIR)"
rm -rf "$BACKUP_DIR"

echo "✅ Backup terminé : rdrive-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
```

### Restauration

```bash
#!/bin/bash
# restore-rdrive.sh

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./restore-rdrive.sh <backup-file.tar.gz>"
  exit 1
fi

# 1. Extraire le backup
echo "📦 Extraction du backup..."
tar -xzf "$BACKUP_FILE"
BACKUP_DIR=$(tar -tzf "$BACKUP_FILE" | head -1 | cut -f1 -d"/")

# 2. Arrêter les services
echo "🛑 Arrêt des services..."
docker compose down

# 3. Restaurer les fichiers
echo "📁 Restauration des fichiers..."
rm -rf docker-data/files/
tar -xzf "$BACKUP_DIR/files.tar.gz"

# 4. Restaurer MongoDB
echo "💾 Restauration MongoDB..."
docker compose up -d mongo
sleep 10
docker cp "$BACKUP_DIR/mongodb" app-rdrive-mongo:/restore
docker exec app-rdrive-mongo mongorestore /restore

# 5. Restaurer PostgreSQL
echo "🗄️ Restauration PostgreSQL..."
docker compose up -d onlyoffice-postgresql
sleep 10
docker exec -i app-rdrive-postgresql psql -U onlyoffice onlyoffice < "$BACKUP_DIR/postgres.sql"

# 6. Restaurer configuration
echo "⚙️ Restauration configuration..."
cp "$BACKUP_DIR/.env" .env
cp "$BACKUP_DIR/docker-compose.yml" docker-compose.yml
cp "$BACKUP_DIR/docker-compose.dev.yml" docker-compose.dev.yml

# 7. Redémarrer tous les services
echo "🚀 Redémarrage des services..."
docker compose up -d

echo "✅ Restauration terminée"
```

### Backup automatique (cron)

```bash
# Éditer crontab
crontab -e

# Ajouter backup quotidien à 2h du matin
0 2 * * * /data/apps/Ryvie-rDrive/tdrive/backup-rdrive.sh

# Nettoyage des backups de plus de 30 jours
0 3 * * * find /backup -name "rdrive-backup-*.tar.gz" -mtime +30 -delete
```

---

## Sécurité

### Bonnes pratiques

#### 1. Variables d'environnement

- ✅ **Ne jamais commiter le `.env`** (déjà dans `.gitignore`)
- ✅ **Utiliser des mots de passe forts** (20+ caractères aléatoires)
- ✅ **Changer les secrets par défaut** (`CREDENTIALS_SECRET`, etc.)

```bash
# Générer un secret aléatoire
openssl rand -hex 32
```

#### 2. Accès réseau

- ✅ **Utiliser HTTPS en production** (Let's Encrypt)
- ✅ **Firewall** : Bloquer tous les ports sauf 80, 443, et NetBird
- ✅ **NetBird** : Chiffrement WireGuard pour accès distant

```bash
# Firewall UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 51820/udp  # NetBird
sudo ufw enable
```

#### 3. Docker

- ✅ **Ne pas exposer MongoDB/PostgreSQL** sur 0.0.0.0
- ✅ **Utiliser des réseaux Docker isolés**
- ✅ **Limiter les ressources** (CPU, RAM)

```yaml
# docker-compose.yml
services:
  mongo:
    # ❌ Mauvais
    ports:
      - "0.0.0.0:27017:27017"
    
    # ✅ Bon (pas de ports exposés)
    networks:
      - tdrive_default
```

#### 4. Mises à jour

```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Mettre à jour Docker
sudo apt install docker-ce docker-ce-cli containerd.io

# Mettre à jour les images
docker compose pull
docker compose up -d
```

#### 5. Logs et monitoring

```bash
# Activer la rotation des logs
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

sudo systemctl restart docker
```

### HTTPS avec Let's Encrypt

```bash
# 1. Installer certbot
sudo apt install certbot

# 2. Obtenir un certificat
sudo certbot certonly --standalone -d votre-domaine.com

# 3. Configurer Nginx dans docker-compose.yml
environment:
  - SSL_CERTS=on
  - DOMAIN=votre-domaine.com

volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro

# 4. Redémarrer
docker compose restart frontend
```

### Authentification

#### LDAP

```bash
# Configuration dans .env
LDAP_URL=ldap://openldap:1389
LDAP_BIND_DN=cn=admin,dc=example,dc=org
LDAP_BIND_PASSWORD=votre_mot_de_passe
LDAP_BASE_DN=dc=example,dc=org
LDAP_USERS_DN=ou=users,dc=example,dc=org
```

#### OAuth (Google, Dropbox)

```bash
# Configuration dans .env
GOOGLE_CLIENT_ID=votre_client_id
GOOGLE_CLIENT_SECRET=votre_client_secret

DROPBOX_APPKEY=votre_app_key
DROPBOX_APPSECRET=votre_app_secret
```

---

## Annexes

### Scripts utiles

#### Script de santé

```bash
#!/bin/bash
# health-check.sh

echo "🏥 Vérification de la santé de rDrive..."

# Backend
if curl -sf http://localhost:4000/diagnostics/t/ready?secret=diag-secret > /dev/null; then
  echo "✅ Backend OK"
else
  echo "❌ Backend KO"
fi

# Frontend
if curl -sf http://localhost:3010 > /dev/null; then
  echo "✅ Frontend OK"
else
  echo "❌ Frontend KO"
fi

# OnlyOffice
if curl -sf http://localhost:8090/healthcheck > /dev/null; then
  echo "✅ OnlyOffice OK"
else
  echo "❌ OnlyOffice KO"
fi

# MongoDB
if docker exec app-rdrive-mongo mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
  echo "✅ MongoDB OK"
else
  echo "❌ MongoDB KO"
fi
```

#### Script de rebuild rapide

```bash
#!/bin/bash
# quick-rebuild.sh

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

SERVICE=$1

if [ -z "$SERVICE" ]; then
    echo "Usage: ./quick-rebuild.sh [service-name]"
    echo "Services: onlyoffice-connector, frontend, node"
    exit 1
fi

echo "🔨 Rebuilding $SERVICE..."
docker compose -f docker-compose.dev.yml build $SERVICE
docker compose -f docker-compose.dev.yml up -d $SERVICE
echo "✅ $SERVICE rebuilt and restarted"
```

### Références

- **rDrive GitHub** : https://github.com/maisonnavejul/Ryvie-rDrive
- **Twake Drive (upstream)** : https://github.com/linagora/twake-drive
- **OnlyOffice Docs** : https://api.onlyoffice.com/editors/basic
- **NetBird** : https://netbird.io/docs
- **Docker Compose** : https://docs.docker.com/compose/

---

**Version** : 1.0.0  
**Date** : 2026-01-05  
**Auteur** : Ryvie  
**License** : AGPL v3
