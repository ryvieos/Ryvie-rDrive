import Logger from '@features/global/framework/logger-service';
import _ from 'lodash';

export enum DownloadStateEnum {
  Progress = 'progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export type DownloadItemType = {
  id: string;
  name: string;
  size: number;
  downloadedSize: number;
  status: 'downloading' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  url: string;
  abortController?: AbortController;
};

export type DownloadListType = { [key: string]: DownloadItemType };

const logger = Logger.getLogger('Services/FileDownloadService');

class FileDownloadService {
  private downloads: DownloadListType = {};
  private recoilHandler: Function = () => undefined;

  setRecoilHandler(handler: Function) {
    this.recoilHandler = handler;
  }

  notify() {
    this.recoilHandler(_.cloneDeep(this.downloads));
  }

  addDownload(id: string, name: string, size: number, url: string, abortController?: AbortController) {
    this.downloads[id] = {
      id,
      name,
      size,
      downloadedSize: 0,
      status: 'downloading',
      progress: 0,
      url,
      abortController,
    };
    this.notify();
  }

  updateProgress(id: string, downloadedSize: number) {
    if (this.downloads[id]) {
      this.downloads[id].downloadedSize = downloadedSize;
      this.downloads[id].progress = this.downloads[id].size > 0 
        ? (downloadedSize / this.downloads[id].size) * 100 
        : 0;
      this.notify();
    }
  }

  completeDownload(id: string) {
    if (this.downloads[id]) {
      this.downloads[id].status = 'completed';
      this.downloads[id].progress = 100;
      this.downloads[id].downloadedSize = this.downloads[id].size;
      this.notify();
      
      // Auto-remove after 5 seconds
      setTimeout(() => {
        this.removeDownload(id);
      }, 5000);
    }
  }

  failDownload(id: string) {
    if (this.downloads[id]) {
      this.downloads[id].status = 'failed';
      this.notify();
    }
  }

  cancelDownload(id: string) {
    if (this.downloads[id]) {
      if (this.downloads[id].abortController) {
        this.downloads[id].abortController?.abort();
      }
      this.downloads[id].status = 'cancelled';
      this.notify();
    }
  }

  removeDownload(id: string) {
    if (this.downloads[id]) {
      delete this.downloads[id];
      this.notify();
    }
  }

  clearCompleted() {
    Object.keys(this.downloads).forEach(id => {
      if (this.downloads[id].status === 'completed') {
        delete this.downloads[id];
      }
    });
    this.notify();
  }

  getDownloads(): DownloadListType {
    return this.downloads;
  }
}

export default new FileDownloadService();
