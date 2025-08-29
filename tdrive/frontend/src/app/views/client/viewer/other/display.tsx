import { useEffect, useState, useRef } from 'react';
import { useEditors } from './editors-service';

export default (props: { download: string; name: string; id: string }) => {
  const extension = props.name.split('.').pop();
  const { getPreviewUrl } = useEditors(extension || '');
  const [previewUrl, setPreviewUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const retryCount = useRef(0);
  const maxRetries = 2;

  useEffect(() => {
    // Reset states when file changes
    setIsLoading(true);
    setError(false);
    retryCount.current = 0;
    
    const url = getPreviewUrl(props.id) || '';
    setPreviewUrl(url);
    
    // Set a timeout to handle loading state
    const loadingTimer = setTimeout(() => {
      if (isLoading && retryCount.current < maxRetries) {
        // Force retry by updating the URL with a timestamp to bypass cache
        setPreviewUrl('');
        setTimeout(() => setPreviewUrl(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()), 10);
        retryCount.current++;
      } else if (isLoading) {
        setError(true);
        setIsLoading(false);
      }
    }, 5000); // Wait 5 seconds before considering it a failure

    return () => clearTimeout(loadingTimer);
  }, [props.id, getPreviewUrl]);

  const handleIframeLoad = () => {
    setIsLoading(false);
    setError(false);
  };

  const handleIframeError = () => {
    if (retryCount.current < maxRetries) {
      // Retry with a new URL to bypass cache
      const newUrl = previewUrl + (previewUrl.includes('?') ? '&' : '?') + 'retry=' + Date.now();
      setPreviewUrl('');
      setTimeout(() => setPreviewUrl(newUrl), 10);
      retryCount.current++;
    } else {
      setIsLoading(false);
      setError(true);
    }
  };

  if (error) {
    return (
      <div className="text-white m-auto w-full text-center block h-full flex flex-col justify-center items-center p-4">
        <span className="block w-full text-center mb-4">Impossible d'afficher le document.</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="text-white m-auto w-full text-center block h-full flex items-center">
        <span className="block w-full text-center">Format de document non pris en charge.</span>
      </div>
    );
  }

  return (
    <>
      <iframe
        ref={iframeRef}
        key={previewUrl} // Force re-render on URL change
        className="w-full h-full left-0 right-0 absolute bottom-0 top-0 testid:preview-url"
        title={props.name}
        src={previewUrl}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        allowFullScreen
      />
    </>
  );
};
