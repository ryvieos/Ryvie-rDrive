import { useEffect, useState } from 'react';
import { useEditors } from './editors-service';
import { useCompanyApplications } from '@features/applications/hooks/use-company-applications';
import { Button } from '@atoms/button/button';

export default (props: { download: string; name: string; id: string }) => {
  const extension = props.name.split('.').pop();
  const { refresh } = useCompanyApplications();
  const { getPreviewUrl } = useEditors(extension || '');
  const [previewUrl, setPreviewUrl] = useState('');
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    // Force refresh applications when component mounts
    console.log('[display] Rafraîchissement des applications au montage du composant');
    refresh();
  }, []);

  useEffect(() => {
    // Recompute preview URL whenever the file id or editors config changes
    const url = getPreviewUrl(props.id);
    setPreviewUrl(url || '');
    
    // Détecter si l'iframe est bloquée après 3 secondes
    if (url) {
      const timer = setTimeout(() => {
        // Vérifier si on est en local (où Chrome peut bloquer)
        const isLocal = window.location.hostname.includes('ryvie.local') || 
                       window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';
        
        if (isLocal) {
          console.warn('[display] Environnement local détecté, l\'iframe peut être bloquée par Chrome');
          // On ne force pas l'erreur, on laisse l'utilisateur voir si ça fonctionne
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [props.id, getPreviewUrl]);
  
  console.log("previewUrl", previewUrl, "props.id", props.id);

  if (!(props.id && previewUrl)) {
    return (
      <>
        <div className="text-white m-auto w-full text-center block h-full flex items-center testid:cannot-display">
          <span className="block w-full text-center">We can't display this document.</span>
        </div>
      </>
    );
  }

  // Si l'iframe est bloquée, afficher un bouton pour ouvrir dans un nouvel onglet
  if (iframeError) {
    return (
      <>
        <div className="text-white m-auto w-full text-center block h-full flex flex-col items-center justify-center testid:iframe-blocked">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-lg mb-2">La prévisualisation ne peut pas être affichée ici</p>
            <p className="text-sm text-gray-400 mb-4">
              Votre navigateur bloque l'accès au réseau local depuis cette page.
            </p>
          </div>
          <Button
            theme="primary"
            onClick={() => window.open(previewUrl, '_blank')}
          >
            Ouvrir la prévisualisation dans un nouvel onglet
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {props.id && previewUrl && (
        <iframe
          className="w-full h-full left-0 right-0 absolute bottom-0 top-0 testid:preview-url"
          title={props.name}
          src={previewUrl}
          onError={() => {
            console.error('[display] Erreur de chargement de l\'iframe');
            setIframeError(true);
          }}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        />
      )}
    </>
  );
};