// Runtime configuration - détecte automatiquement l'environnement
(function() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  console.log('🔍 [rDrive Config] Détection environnement - hostname:', hostname, 'protocol:', protocol);
  
  // Détection des réseaux locaux/privés : localhost, ryvie.local, et plages IP privées (10.x, 172.16-31.x, 192.168.x, 100.x Tailscale)
  const isLocal = hostname === 'ryvie.local' || 
                  hostname === 'localhost' || 
                  hostname.startsWith('192.168.') || 
                  hostname.startsWith('10.') ||
                  hostname.startsWith('172.') ;
  
  console.log('🔍 [rDrive Config] isLocal:', isLocal);
  
  if (isLocal) {
    // Configuration locale
    // Récupération de l'IP privée depuis la variable d'environnement injectée au build
    const privateIP = '__REACT_APP_FRONTEND_URL_PRIVATE__';
    
    console.log('🔍 [rDrive Config] Variable REACT_APP_FRONTEND_URL_PRIVATE brute:', privateIP);
    
    // Vérifier si la variable a été remplacée (si elle ne contient pas de __)
    const hasPrivateIP = privateIP && !privateIP.includes('__');
    
    console.log('🔍 [rDrive Config] hasPrivateIP:', hasPrivateIP, '- Valeur:', hasPrivateIP ? privateIP : 'NON DÉFINIE');
    
    // Si on accède via ryvie.local, on utilise l'IP privée pour OnlyOffice pour éviter les problèmes CORS
    const usePrivateIP = hostname === 'ryvie.local' && hasPrivateIP;
    const onlyofficeHost = usePrivateIP ? privateIP : hostname;
    
    console.log('🔍 [rDrive Config] usePrivateIP:', usePrivateIP);
    console.log('🔍 [rDrive Config] onlyofficeHost calculé:', onlyofficeHost);
    
    if (hostname === 'ryvie.local' && !hasPrivateIP) {
      console.warn('⚠️ [rDrive Config] Accès via ryvie.local mais REACT_APP_FRONTEND_URL_PRIVATE non définie, utilisation de:', hostname);
    }
    
    window.APP_CONFIG = {
      FRONTEND_URL: protocol + '//' + hostname,
      BACKEND_URL: protocol + '//' + hostname + ':4000',
      WEBSOCKET_URL: (protocol === 'https:' ? 'wss:' : 'ws:') + '//' + hostname + ':4000/ws',
      // Le connecteur utilise l'IP privée si on accède via ryvie.local
      ONLYOFFICE_CONNECTOR_URL: protocol + '//' + onlyofficeHost + ':5000',
      ONLYOFFICE_DOCUMENT_SERVER_URL: protocol + '//' + onlyofficeHost + ':8090'
    };
    
    console.log('🔧 [rDrive Config] Mode local détecté:', hostname, '→ OnlyOffice via:', onlyofficeHost);
  } else {
    // Configuration publique (injectée au build)
    console.log('🌐 [rDrive Config] Mode public détecté');
    window.APP_CONFIG = {
      FRONTEND_URL: '__REACT_APP_FRONTEND_URL__',
      BACKEND_URL: '__REACT_APP_BACKEND_URL__',
      WEBSOCKET_URL: '__REACT_APP_WEBSOCKET_URL__',
      ONLYOFFICE_CONNECTOR_URL: '__REACT_APP_ONLYOFFICE_CONNECTOR_URL__',
      ONLYOFFICE_DOCUMENT_SERVER_URL: '__REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL__'
    };
  }
  
  console.log('🚀 [rDrive Config] Configuration finale:', window.APP_CONFIG);
})();
