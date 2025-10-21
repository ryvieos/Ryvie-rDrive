import { useRecoilState } from 'recoil';
import { DownloadsListState } from '../state/atoms/downloads-list';
import FileDownloadService from '../services/file-download-service';

export const useDownload = () => {
  const [downloadsListState, setDownloadsListState] = useRecoilState(DownloadsListState);
  FileDownloadService.setRecoilHandler(setDownloadsListState);

  const cancelDownload = (id: string) => FileDownloadService.cancelDownload(id);

  const removeDownload = (id: string) => FileDownloadService.removeDownload(id);

  const clearCompleted = () => FileDownloadService.clearCompleted();

  return {
    downloadsListState,
    cancelDownload,
    removeDownload,
    clearCompleted,
  };
};
