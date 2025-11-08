# Configuration Runtime rDrive

## Fonctionnement

L'application détecte automatiquement l'environnement d'exécution :

### Accès Local (ryvie.local ou localhost)
Lorsque vous accédez à l'application via :
- `ryvie.local`
- `localhost`
- Adresse IP privée (192.168.x.x, 10.x.x.x)

Les URLs suivantes sont utilisées automatiquement :
```
Frontend:    http://ryvie.local:3010
Backend:     http://ryvie.local:4000
WebSocket:   ws://ryvie.local:4000/ws
OnlyOffice Connector: http://ryvie.local:5000
OnlyOffice Document:  http://ryvie.local:8090
```

### Accès Public
Lorsque vous accédez via une adresse publique, les URLs du fichier `.env` sont utilisées :
```
REACT_APP_FRONTEND_URL=https://rdrive-vqoe9n1u.ryvie.fr
REACT_APP_BACKEND_URL=https://backend-rdrive-vqoe9n1u.ryvie.fr
REACT_APP_WEBSOCKET_URL=wss://backend-rdrive-vqoe9n1u.ryvie.fr/ws
REACT_APP_ONLYOFFICE_CONNECTOR_URL=https://connector-rdrive-vqoe9n1u.ryvie.fr
REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL=https://document-rdrive-vqoe9n1u.ryvie.fr
```

## Fichiers modifiés

1. **`frontend/public/config.js`** - Configuration runtime injectée au démarrage
2. **`frontend/public/index.html`** - Charge config.js avant l'application
3. **`frontend/src/app/environment/environment.ts.dist`** - Utilise window.APP_CONFIG
4. **`docker/tdrive-frontend/entrypoint.sh`** - Injecte les variables au runtime
5. **`docker-compose.yml`** - Passe les variables d'environnement au conteneur

## Rebuild nécessaire

Pour appliquer ces changements :
```bash
docker-compose down
docker-compose build frontend
docker-compose up -d
```

## Debug

Pour vérifier la configuration chargée, ouvrez la console du navigateur :
```javascript
console.log(window.APP_CONFIG);
```
