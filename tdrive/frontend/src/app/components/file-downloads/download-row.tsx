import { useCallback } from 'react';
import { useDownload } from '@features/files/hooks/use-download';
import { DownloadItemType } from 'app/features/files/services/file-download-service';
import { CancelIcon, CheckGreenIcon, RemoveIcon } from 'app/atoms/icons-colored';
import Languages from '@features/global/services/languages-service';
import {
  FileTypeArchiveIcon,
  FileTypeDocumentIcon,
  FileTypePdfIcon,
  FileTypeSpreadsheetIcon,
  FileTypeUnknownIcon,
  FileTypeMediaIcon,
  FileTypeSlidesIcon,
  FileTypeLinkIcon,
  FolderIcon,
} from 'app/atoms/icons-colored';

const fileTypeIconsMap = {
  // Archives
  zip: <FileTypeArchiveIcon />,
  rar: <FileTypeArchiveIcon />,
  '7z': <FileTypeArchiveIcon />,
  tar: <FileTypeArchiveIcon />,
  gz: <FileTypeArchiveIcon />,
  
  // Documents
  doc: <FileTypeDocumentIcon />,
  docx: <FileTypeDocumentIcon />,
  txt: <FileTypeDocumentIcon />,
  rtf: <FileTypeDocumentIcon />,
  odt: <FileTypeDocumentIcon />,
  
  // PDF
  pdf: <FileTypePdfIcon />,
  
  // Spreadsheets
  xls: <FileTypeSpreadsheetIcon />,
  xlsx: <FileTypeSpreadsheetIcon />,
  csv: <FileTypeSpreadsheetIcon />,
  ods: <FileTypeSpreadsheetIcon />,
  
  // Presentations
  ppt: <FileTypeSlidesIcon />,
  pptx: <FileTypeSlidesIcon />,
  odp: <FileTypeSlidesIcon />,
  
  // Media
  jpg: <FileTypeMediaIcon />,
  jpeg: <FileTypeMediaIcon />,
  png: <FileTypeMediaIcon />,
  gif: <FileTypeMediaIcon />,
  bmp: <FileTypeMediaIcon />,
  svg: <FileTypeMediaIcon />,
  mp4: <FileTypeMediaIcon />,
  avi: <FileTypeMediaIcon />,
  mov: <FileTypeMediaIcon />,
  mp3: <FileTypeMediaIcon />,
  wav: <FileTypeMediaIcon />,
};

const DownloadRow = ({ download }: { download: DownloadItemType }): JSX.Element => {
  const { cancelDownload, removeDownload } = useDownload();
  
  const fileExtension = download.name.includes('.') ? download.name.split('.').pop()?.toLowerCase() : '';
  const isCompleted = download.status === 'completed';
  const isFailed = download.status === 'failed';
  const isCancelled = download.status === 'cancelled';

  // Helper to convert size to the closest unit (Ko, Mo, Go only)
  const formatFileSize = (sizeInBytes: number): string => {
    if (!sizeInBytes) return '0 Ko';
    
    const k = 1024;
    if (sizeInBytes < k) {
      // Forcer minimum à Ko
      return `${(sizeInBytes / k).toFixed(2)} Ko`;
    }
    if (sizeInBytes < k ** 2) return `${(sizeInBytes / k).toFixed(2)} Ko`;
    if (sizeInBytes < k ** 3) return `${(sizeInBytes / k ** 2).toFixed(2)} Mo`;
    return `${(sizeInBytes / k ** 3).toFixed(2)} Go`;
  };

  // Helper to truncate the file name if it is too long
  const truncateFileName = (fileName: string): string => {
    if (fileName.length > 30) {
      return `${fileName.substring(0, 20)}...`;
    }
    return fileName;
  };

  const itemTypeIcon = useCallback(
    (type: string) =>
      fileTypeIconsMap[type as keyof typeof fileTypeIconsMap] || <FileTypeUnknownIcon />,
    [],
  );

  const handleCancel = () => {
    cancelDownload(download.id);
  };

  const handleRemove = () => {
    removeDownload(download.id);
  };

  return (
    <div className="download-row testid:download-row">
      <div className="download-details mt-2">
        <div className="flex items-center">
          <div className="w-10 h-10 flex items-center justify-center bg-[#f3f3f7] rounded-md">
            <div className="w-full h-full flex items-center justify-center testid:download-row-type">
              {itemTypeIcon(fileExtension || '')}
            </div>
          </div>
          <p className="ml-4">
            <span className="font-bold">{truncateFileName(download.name)} </span>
            {!isFailed && !isCancelled && download.status === 'downloading' && (
              <span className="ml-4 text-sm">
                {download.size > 0 
                  ? `(${formatFileSize(download.downloadedSize)} / ${formatFileSize(download.size)})`
                  : `(${formatFileSize(download.downloadedSize)} téléchargé...)`
                }
              </span>
            )}
            {!isFailed && !isCancelled && isCompleted && (
              <span className="ml-4 text-sm">
                ({formatFileSize(download.downloadedSize || download.size)})
              </span>
            )}
            {isFailed && (
              <span className="ml-4 text-red-500">{Languages.t('general.download_failed')}</span>
            )}
            {isCancelled && (
              <span className="ml-4 text-orange-500">{Languages.t('general.download_cancelled')}</span>
            )}
          </p>

          <div className="progress-check flex items-center justify-center ml-auto">
            {isCompleted ? (
              <button
                onClick={handleRemove}
                className="hover:bg-gray-100 p-2 rounded-md transition-all duration-200 testid:download-row-remove"
              >
                <CheckGreenIcon className="opacity-1 hover:scale-110 transition-transform duration-200" />
              </button>
            ) : (
              !isCancelled && !isFailed && (
                <button
                  className="ml-2 hover:bg-red-100 p-2 rounded-md transition-all duration-200 testid:download-row-cancel"
                  onClick={handleCancel}
                >
                  <CancelIcon className="hover:scale-110 transition-transform duration-200" />
                </button>
              )
            )}
            {(isCancelled || isFailed) && (
              <button
                onClick={handleRemove}
                className="hover:bg-gray-100 p-2 rounded-md transition-all duration-200 testid:download-row-remove"
              >
                <RemoveIcon className="hover:scale-110 transition-transform duration-200" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="download-progress h-[3px] mt-4">
        <div className="w-full h-[3px] bg-[#F0F2F3]">
          <div
            className={`testid:download-row-progress h-full ${
              isFailed
                ? 'bg-[#FF0000]' // Red color for failed downloads
                : isCancelled
                ? 'bg-[#FFA500]' // Orange for cancelled downloads
                : 'bg-[#00A029]' // Green for successful downloads
            }`}
            style={{
              width: `${
                isFailed || isCancelled ? 100 : download.progress
              }%`,
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default DownloadRow;
