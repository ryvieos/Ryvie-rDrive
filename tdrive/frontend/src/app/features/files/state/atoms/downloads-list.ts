import { atom } from 'recoil';
import { DownloadListType } from '../../services/file-download-service';

export const DownloadsListState = atom<DownloadListType>({
  key: 'DownloadsListState',
  default: {},
});
