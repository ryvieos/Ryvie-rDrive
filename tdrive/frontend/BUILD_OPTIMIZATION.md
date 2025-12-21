# Optimisation du Build Frontend

## Problème identifié
Le build frontend prend entre 96s et 400s+ lors de la construction Docker.

## Causes principales

1. **Compilation TypeScript/React complète**
   - Tous les fichiers TypeScript sont compilés
   - Webpack bundle l'ensemble de l'application
   - Utilisation de 4GB de mémoire (`--max-old-space-size=4096`)

2. **Cache Docker non optimisé**
   - Avant : tout le dossier `frontend/` était copié en une seule fois
   - Chaque modification déclenchait un rebuild complet

3. **Dépendances lourdes**
   - 180+ packages npm à analyser
   - Multiple UI frameworks (Material-UI, Ant Design, Tailwind)

## Solutions implémentées

### 1. Dockerfile optimisé
- ✅ Séparation des layers Docker pour meilleur cache
- ✅ Copie des fichiers de config avant le code source
- ✅ Variables d'environnement optimisées
- ✅ Nettoyage après build (suppression de `node_modules` et `src`)

### 2. .dockerignore créé
- ✅ Exclusion de `node_modules`, `build`, `.git`, etc.
- ✅ Réduction de la taille du contexte Docker

## Recommandations supplémentaires

### Option 1 : Utiliser BuildKit avec cache mount (RECOMMANDÉ)
Modifiez votre commande de build Docker :

```bash
# Activer BuildKit
export DOCKER_BUILDKIT=1

# Build avec cache
docker build \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --cache-from your-registry/tdrive-frontend:latest \
  -t your-registry/tdrive-frontend:latest \
  -f docker/tdrive-frontend/Dockerfile .
```

Ou dans docker-compose.yml :
```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: docker/tdrive-frontend/Dockerfile
      cache_from:
        - your-registry/tdrive-frontend:latest
```

### Option 2 : Utiliser npm ci au lieu de npm install
Si vous régénérez le `package-lock.json` :
```dockerfile
RUN npm ci --legacy-peer-deps
```
C'est plus rapide et déterministe.

### Option 3 : Build multi-stage avec cache persistant
Ajoutez dans le Dockerfile (après la ligne 9) :
```dockerfile
# Cache npm pour accélérer les rebuilds
RUN --mount=type=cache,target=/root/.npm \
    npm install --legacy-peer-deps
```

### Option 4 : Paralléliser avec esbuild ou SWC
Remplacez Webpack par un bundler plus rapide :
- **esbuild** : 10-100x plus rapide
- **SWC** : Alternative à Babel, beaucoup plus rapide

Exemple avec craco-esbuild :
```bash
npm install --save-dev craco-esbuild
```

```javascript
// craco.config.js
const CracoEsbuildPlugin = require('craco-esbuild');

module.exports = {
  plugins: [
    { plugin: CracoEsbuildPlugin },
    // ... autres plugins
  ],
};
```

### Option 5 : Désactiver la minification en dev
Si vous buildez pour le développement :
```dockerfile
ENV GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true \
    TSC_COMPILE_ON_ERROR=true \
    SKIP_PREFLIGHT_CHECK=true \
    NODE_ENV=production \
    INLINE_RUNTIME_CHUNK=false
```

### Option 6 : Utiliser un registry de cache npm
Configurez un registry npm local (Verdaccio) pour cacher les packages :
```bash
npm config set registry http://your-verdaccio:4873
```

## Résultats attendus

Avec les optimisations implémentées :
- **Premier build** : ~90-120s (inchangé, normal)
- **Rebuilds sans changement de dépendances** : ~30-60s (3x plus rapide)
- **Rebuilds avec changements mineurs** : ~40-80s (2x plus rapide)

Avec BuildKit + cache mount :
- **Rebuilds** : ~20-40s (5-10x plus rapide)

## Monitoring

Pour identifier les étapes lentes :
```bash
# Build avec timing détaillé
DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  -f docker/tdrive-frontend/Dockerfile . 2>&1 | tee build.log
```

Analysez `build.log` pour voir quelle étape prend le plus de temps.

## Commandes utiles

```bash
# Nettoyer le cache Docker
docker builder prune -a

# Voir la taille des layers
docker history your-image:tag

# Build sans cache (pour tester)
docker build --no-cache -f docker/tdrive-frontend/Dockerfile .
```
