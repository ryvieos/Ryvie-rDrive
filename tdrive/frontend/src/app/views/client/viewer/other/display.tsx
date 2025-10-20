import { useEffect, useState } from 'react';
import { useEditors } from './editors-service';
import { useCompanyApplications } from '@features/applications/hooks/use-company-applications';

export default (props: { download: string; name: string; id: string }) => {
  const extension = props.name.split('.').pop();
  const { refresh } = useCompanyApplications();
  const { getPreviewUrl } = useEditors(extension || '');
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    // Force refresh applications when component mounts
    console.log('[display] Rafraîchissement des applications au montage du composant');
    refresh();
  }, []);

  useEffect(() => {
    // Recompute preview URL whenever the file id or editors config changes
    setPreviewUrl(getPreviewUrl(props.id) || '');
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

  return (
    <>
      {props.id && previewUrl && (
        <iframe
          className="w-full h-full left-0 right-0 absolute bottom-0 top-0 testid:preview-url"
          title={props.name}
          src={previewUrl}
        />
      )}
    </>
  );
};