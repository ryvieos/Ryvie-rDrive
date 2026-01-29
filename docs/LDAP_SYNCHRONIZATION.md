# Documentation de Synchronisation LDAP - rDrive

## 📋 Vue d'ensemble

La synchronisation LDAP permet de maintenir automatiquement les utilisateurs de rDrive en phase avec votre serveur LDAP (Ryvie Manager). Cette synchronisation est **unidirectionnelle** : LDAP → rDrive.

### Fonctionnalités

- ✅ **Création automatique** des nouveaux utilisateurs LDAP dans rDrive
- ✅ **Mise à jour** des informations utilisateur (email, nom, prénom)
- ✅ **Suppression automatique** des utilisateurs retirés de LDAP
- ✅ **Préservation des données** lors du changement d'email
- ✅ **Logs minimalistes** et résumé clair des opérations

---

## 🔧 Configuration

### Variables d'environnement requises

Dans votre fichier `docker-compose.yml` ou `.env` :

```yaml
environment:
  LDAP_URL: "ldap://openldap:389"
  LDAP_BIND_DN: "cn=admin,dc=ryvie,dc=local"
  LDAP_BIND_PASSWORD: "votre_mot_de_passe"
  LDAP_BASE_DN: "dc=ryvie,dc=local"
  LDAP_USERS_DN: "ou=users,dc=ryvie,dc=local"
```

### Identifiant unique

Le script utilise le champ **`uid`** LDAP comme identifiant unique et immuable :
- Stocké dans `username_canonical` dans rDrive
- Permet de suivre un utilisateur même si son email change
- **Ne jamais modifier le `uid` d'un utilisateur existant**

---

## 🚀 Utilisation

### Lancement manuel

```bash
docker exec app-rdrive-node-create-user node dist/bin/sync_ldap_users.js
```

### Automatisation (cron)

Ajoutez dans votre `crontab` ou créez un service systemd :

```bash
# Synchronisation toutes les heures
0 * * * * docker exec app-rdrive-node-create-user node dist/bin/sync_ldap_users.js >> /var/log/rdrive-ldap-sync.log 2>&1
```

Ou avec systemd timer :

```ini
# /etc/systemd/system/rdrive-ldap-sync.timer
[Unit]
Description=rDrive LDAP Sync Timer

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/rdrive-ldap-sync.service
[Unit]
Description=rDrive LDAP Synchronization

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec app-rdrive-node-create-user node dist/bin/sync_ldap_users.js
```

---

## 📊 Fonctionnement détaillé

### 1. Création d'utilisateur

Quand un nouvel utilisateur est détecté dans LDAP :

1. **Création du compte rDrive**
   - `username_canonical` = `uid` LDAP
   - `email_canonical` = email LDAP (en minuscules)
   - `first_name` = givenName LDAP (ou uid si absent)
   - `last_name` = sn LDAP (vide si identique à first_name)

2. **Association à la company par défaut**
   - Company ID : `2b4daa30-de77-11f0-b6a0-47e2f4bdf7b4`
   - Rôle : `member`

3. **Création du workspace personnel**
   - Nom : `{first_name}'s space`
   - Workspace ID : généré automatiquement

4. **Création du répertoire utilisateur**
   - Drive personnel dans le workspace

**Log affiché :**
```
🆕 Creating: uid (email@example.com)
```

### 2. Mise à jour d'utilisateur

Le script détecte et met à jour automatiquement :

#### Email modifié
```
📧 Email updated: uid (old@email.com → new@email.com)
```
**Important :** Les données utilisateur (fichiers, workspaces) sont **préservées** car l'identification se fait par `uid`, pas par email.

#### Nom/Prénom modifié
Mise à jour silencieuse (pas de log sauf erreur).

#### Correction des noms en double
Si `first_name` = `last_name` dans LDAP, le script vide automatiquement `last_name` pour éviter l'affichage "cynthia cynthia".

### 3. Suppression d'utilisateur

Quand un utilisateur n'existe plus dans LDAP :

1. **Détection** : Le `uid` n'est plus présent dans LDAP
2. **Anonymisation** : 
   - `username_canonical` → `deleted-user-{hash}`
   - `email_canonical` → `{hash}@tdrive.removed`
   - `deleted` → `true`
3. **Suppression des données** :
   - Fichiers personnels
   - Workspaces
   - Associations company
   - Index de recherche

**Log affiché :**
```
🗑️  Deleting: uid (email@example.com)
```

---

## 📈 Résumé de synchronisation

À la fin de chaque exécution, le script affiche un résumé compact :

```
📊 Sync Summary: 🆕 2 created | 🔄 3 updated | 🗑️ 1 deleted | ❌ 0 errors
```

- **🆕 Created** : Nouveaux utilisateurs ajoutés
- **🔄 Updated** : Utilisateurs mis à jour (email, nom, etc.)
- **🗑️ Deleted** : Utilisateurs supprimés (absents de LDAP)
- **❌ Errors** : Erreurs rencontrées

---

## 🔍 Vérification et dépannage

### Vérifier les utilisateurs synchronisés

```bash
docker exec app-rdrive-mongo mongosh tdrive --quiet --eval "
db.user.find({deleted: false}, {username_canonical: 1, email_canonical: 1, first_name: 1, last_name: 1}).forEach(u => 
  print(u.username_canonical + ' | ' + u.email_canonical + ' | ' + u.first_name + ' ' + u.last_name)
)"
```

### Vérifier l'index de recherche

```bash
docker exec app-rdrive-mongo mongosh tdrive --quiet --eval "
db.search__user.countDocuments()
"
```

### Forcer la réindexation

Si les utilisateurs n'apparaissent pas dans l'interface :

```bash
docker exec app-rdrive-node-create-user node dist/bin/reindex.js
```

### Logs détaillés

Pour activer les logs DEBUG temporairement :

```bash
docker exec -e LOG_LEVEL=debug app-rdrive-node-create-user node dist/bin/sync_ldap_users.js
```

---

## ⚠️ Limitations et précautions

### Limitations actuelles

1. **Synchronisation unidirectionnelle** : LDAP → rDrive uniquement
   - Les modifications dans rDrive ne sont PAS synchronisées vers LDAP
   - Gérer les utilisateurs via Ryvie Manager (interface LDAP)

2. **Pas de gestion des groupes LDAP**
   - Tous les utilisateurs sont créés avec le rôle `member`
   - Les groupes LDAP ne sont pas importés

3. **Workspace unique par défaut**
   - Chaque utilisateur reçoit un workspace personnel
   - Pas de synchronisation des workspaces partagés

### Précautions importantes

⚠️ **Ne jamais modifier le `uid` LDAP** d'un utilisateur existant
- Le script le considérera comme un nouvel utilisateur
- L'ancien compte sera supprimé avec toutes ses données

⚠️ **Sauvegardes régulières**
- Avant toute synchronisation massive
- Avant modification de la structure LDAP

⚠️ **Tester en environnement de développement**
- Valider les modifications du script avant production
- Vérifier les logs après chaque synchronisation

---

## 🔐 Sécurité

### Bonnes pratiques

1. **Mot de passe LDAP sécurisé**
   ```yaml
   # Utiliser Docker secrets
   secrets:
     - ldap_bind_password
   ```

2. **Connexion LDAP chiffrée** (recommandé)
   ```yaml
   LDAP_URL: "ldaps://openldap:636"
   ```

3. **Permissions restreintes**
   - Le compte LDAP de synchronisation doit avoir accès en lecture seule
   - Pas besoin de droits d'écriture sur LDAP

4. **Logs sécurisés**
   - Les mots de passe ne sont jamais loggés
   - Rotation des logs recommandée

---

## 📝 Structure des données

### Utilisateur rDrive

```typescript
{
  id: "uuid",
  username_canonical: "uid-ldap",        // Identifiant unique LDAP
  email_canonical: "email@example.com",  // Email en minuscules
  first_name: "Prénom",
  last_name: "Nom",                      // Vide si identique à first_name
  deleted: false,
  mail_verified: true,
  cache: {
    companies: ["company-uuid"]
  },
  preferences: {
    recent_workspaces: [{
      company_id: "company-uuid",
      workspace_id: "workspace-uuid"
    }]
  }
}
```

### Index de recherche

```typescript
{
  id: "user-uuid",
  username: "uid-ldap",
  email: "email@example.com",
  first_name: "Prénom",
  last_name: "Nom",
  companies: ["company-uuid"]
}
```

---

## 🛠️ Modifications du script

### Fichier principal

`/data/apps/Ryvie-rDrive/tdrive/backend/node/src/bin/sync_ldap_users.ts`

### Recompilation après modification

```bash
cd /data/apps/Ryvie-rDrive/tdrive/backend/node
npm run build
```

### Redémarrage du service

```bash
cd /data/apps/Ryvie-rDrive/tdrive
docker-compose restart node
```

---

## 📞 Support et évolutions futures

### Évolutions possibles

- [ ] Synchronisation bidirectionnelle (rDrive ↔ LDAP)
- [ ] Import des groupes LDAP
- [ ] Synchronisation des workspaces partagés
- [ ] Gestion des rôles basée sur les groupes LDAP
- [ ] Synchronisation incrémentielle (delta sync)
- [ ] Webhooks pour synchronisation en temps réel

### Contribution

Pour proposer des améliorations ou signaler des bugs :
1. Tester en environnement de développement
2. Documenter le comportement attendu vs actuel
3. Fournir les logs pertinents

---

## 📚 Références

- **LDAP RFC** : RFC 4511 (Lightweight Directory Access Protocol)
- **rDrive Architecture** : `/data/apps/Ryvie-rDrive/tdrive/backend/node/src/`
- **Ryvie Manager** : Interface de gestion LDAP
- **MongoDB** : Base de données rDrive

---

*Dernière mise à jour : 29 janvier 2026*
