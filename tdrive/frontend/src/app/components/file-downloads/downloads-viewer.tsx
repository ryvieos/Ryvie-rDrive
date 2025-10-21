import { useDownload } from '@features/files/hooks/use-download';
import DownloadList from './download-list';

const DownloadsViewer = (): JSX.Element => {
  const { downloadsListState } = useDownload();

  const downloadKeys = Object.keys(downloadsListState);

  // Early return for clarity
  if (downloadKeys.length === 0) {
    return <></>;
  }

  return <DownloadList downloads={downloadsListState} />;
};

export default DownloadsViewer;
