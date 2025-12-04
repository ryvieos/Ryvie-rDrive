// Runtime configuration - détecte automatiquement l'environnement
(function() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isLocal = hostname === 'ryvie.local' || hostname === 'localhost' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
  
  if (isLocal) {
    // Configuration locale
    window.APP_CONFIG = {
      FRONTEND_URL: protocol + '//' + hostname,
      BACKEND_URL: protocol + '//' + hostname + ':4000',
      WEBSOCKET_URL: (protocol === 'https:' ? 'wss:' : 'ws:') + '//' + hostname + ':4000/ws',
      // Le connecteur est servi via le proxy Caddy sous la même origine
      ONLYOFFICE_CONNECTOR_URL: protocol + '//' + hostname + ':5000',
      ONLYOFFICE_DOCUMENT_SERVER_URL: protocol + '//' + hostname + ':8090'
    };
  } else {
    // Configuration publique (injectée au build)
    window.APP_CONFIG = {
      FRONTEND_URL: '__REACT_APP_FRONTEND_URL__',
      BACKEND_URL: '__REACT_APP_BACKEND_URL__',
      WEBSOCKET_URL: '__REACT_APP_WEBSOCKET_URL__',
      ONLYOFFICE_CONNECTOR_URL: '__REACT_APP_ONLYOFFICE_CONNECTOR_URL__',
      ONLYOFFICE_DOCUMENT_SERVER_URL: '__REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL__'
    };
  }
  
  console.log('🚀 rDrive Config:', window.APP_CONFIG);
})();
