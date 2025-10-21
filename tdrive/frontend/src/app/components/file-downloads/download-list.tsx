import { useState, useMemo, useCallback } from 'react';
import { useDownload } from '@features/files/hooks/use-download';
import PerfectScrollbar from 'react-perfect-scrollbar';
import { ArrowDownIcon, ArrowUpIcon } from 'app/atoms/icons-colored';
import { DownloadListType } from 'app/features/files/services/file-download-service';
import Languages from '@features/global/services/languages-service';
import DownloadRow from './download-row';

const getFilteredDownloads = (keys: string[], downloads: DownloadListType) => {
  const inProgress = keys.filter(key => downloads[key].status === 'downloading');
  const completed = keys.filter(key => downloads[key].status === 'completed');
  const failed = keys.filter(key => downloads[key].status === 'failed');
  const cancelled = keys.filter(key => downloads[key].status === 'cancelled');
  return { inProgress, completed, failed, cancelled };
};

interface ModalHeaderProps {
  downloadingCount: number;
  completedCount: number;
  totalDownloads: number;
  toggleModal: () => void;
  modalExpanded: boolean;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({
  downloadingCount,
  completedCount,
  totalDownloads,
  toggleModal,
  modalExpanded,
}) => (
  <div className="w-full flex bg-[#45454A] text-white p-4 items-center justify-between">
    <p className="testid:download-modal-head-status">
      {downloadingCount > 0
        ? `${Languages.t('general.downloading')} ${downloadingCount}`
        : `${Languages.t('general.downloaded')} ${completedCount}`}{' '}
      {Languages.t('general.files')}
    </p>
    <button
      className="ml-auto flex items-center testid:download-modal-toggle-arrow"
      onClick={toggleModal}
    >
      {modalExpanded ? <ArrowDownIcon /> : <ArrowUpIcon />}
    </button>
  </div>
);

interface ModalFooterProps {
  clearCompleted: () => void;
  completedCount: number;
}

const ModalFooter: React.FC<ModalFooterProps> = ({
  clearCompleted,
  completedCount,
}) => {
  return (
    <div className="w-full flex flex-wrap bg-[#F0F2F3] text-black p-4 items-center justify-between">
      <div className="w-full flex flex-wrap gap-2 justify-center sm:justify-end">
        {completedCount > 0 && (
          <button
            className="text-blue-500 px-4 py-2 rounded bg-transparent transition-all duration-300 ease-in-out 
            hover:bg-blue-600 hover:text-white w-full sm:w-auto testid:download-modal-clear"
            onClick={clearCompleted}
          >
            {Languages.t('general.clear_completed')}
          </button>
        )}
      </div>
    </div>
  );
};

const DownloadList = ({
  downloads,
}: {
  downloads: DownloadListType;
}): JSX.Element => {
  const [modalExpanded, setModalExpanded] = useState(true);
  const { clearCompleted } = useDownload();
  const keys = useMemo(() => Object.keys(downloads || {}), [downloads]);

  const {
    inProgress: downloadsInProgress,
    completed: downloadsCompleted,
    failed: downloadsFailed,
    cancelled: downloadsCancelled,
  } = useMemo(() => getFilteredDownloads(keys, downloads), [keys, downloads]);

  const totalDownloads = keys.length;
  const downloadingCount = downloadsInProgress.length;
  const completedCount = downloadsCompleted.length;

  const toggleModal = useCallback(() => setModalExpanded(prev => !prev), []);

  return (
    <>
      {totalDownloads > 0 && (
        <div
          className="fixed bottom-4 right-4 w-full sm:w-1/2 md:w-1/3 max-w-lg shadow-lg rounded-sm overflow-hidden testid:download-modal 
                sm:right-4 sm:left-auto sm:translate-x-0 left-1/2 -translate-x-1/2"
        >
          <ModalHeader
            downloadingCount={downloadingCount}
            completedCount={completedCount}
            totalDownloads={totalDownloads}
            toggleModal={toggleModal}
            modalExpanded={modalExpanded}
          />

          <div className={`modal-body ${modalExpanded ? 'block' : 'hidden'}`}>
            <div className="bg-white px-4 py-2">
              <PerfectScrollbar
                options={{ suppressScrollX: true, suppressScrollY: false }}
                component="div"
                style={{ width: '100%', maxHeight: 300 }}
              >
                {keys.map(key => (
                  <DownloadRow key={key} download={downloads[key]} />
                ))}
              </PerfectScrollbar>
            </div>
            <ModalFooter
              clearCompleted={clearCompleted}
              completedCount={completedCount}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default DownloadList;
