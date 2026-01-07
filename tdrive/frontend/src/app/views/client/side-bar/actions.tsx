import { PlusIcon, TruckIcon, UploadIcon } from '@heroicons/react/outline';
import { useCallback, useRef } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { AnimatedHeight } from '../../../atoms/animated-height';
import { getFilesTree } from '../../../components/uploads/file-tree-utils';
import UploadZone from '../../../components/uploads/upload-zone';
import { useDriveItem } from '../../../features/drive/hooks/use-drive-item';
import { useDriveUpload } from '../../../features/drive/hooks/use-drive-upload';
import useRouterCompany from '../../../features/router/hooks/use-router-company';
import { DriveCurrentFolderAtom } from '../body/drive/browser';
import { ConfirmDeleteModalAtom } from '../body/drive/modals/confirm-delete';
import { CreateModal, CreateModalAtom } from '../body/drive/modals/create';
import { UploadModelAtom, UploadModal } from '../body/drive/modals/upload'
import { Button } from '@atoms/button/button';
import Languages from "features/global/services/languages-service";
import { useCurrentUser } from 'app/features/users/hooks/use-current-user';
import useRouteState from 'app/features/router/hooks/use-route-state';
import { useHistory } from 'react-router-dom';
import { TrashIcon } from '@heroicons/react/outline';

export const CreateModalWithUploadZones = ({ initialParentId }: { initialParentId?: string }) => {
  const companyId = useRouterCompany();
  const uploadZoneRef = useRef<UploadZone | null>(null);
  const uploadFolderZoneRef = useRef<UploadZone | null>(null);
  const setCreationModalState = useSetRecoilState(CreateModalAtom);
  const setUploadModalState = useSetRecoilState(UploadModelAtom);
  const { uploadTree, uploadFromUrl } = useDriveUpload();
  const { user } = useCurrentUser();
  const [ parentId ] = useRecoilState(
    DriveCurrentFolderAtom({ initialFolderId: initialParentId || 'user_'+user?.id }),
  );

  return (
    <>
      <UploadZone
        overClassName={'!hidden'}
        className="hidden"
        testClassId="create-modal-upload-file-zone"
        disableClick
        parent={''}
        multiple={true}
        ref={uploadZoneRef}
        driveCollectionKey={'side-menu'}
        onAddFiles={async (_, event) => {
          const tree = await getFilesTree(event);
          setCreationModalState({ parent_id: '', open: false });
          uploadTree(tree, {
            companyId,
            parentId,
          });
          setUploadModalState({ parent_id: '', open: false });
        }}
      />
      <UploadZone
        overClassName={'!hidden'}
        className="hidden"
        testClassId="create-modal-upload-folder-zone"
        disableClick
        parent={''}
        multiple={true}
        ref={uploadFolderZoneRef}
        directory={true}
        driveCollectionKey={'side-menu'}
        onAddFiles={async (_, event) => {
          const tree = await getFilesTree(event);
          setCreationModalState({ parent_id: '', open: false });
          uploadTree(tree, {
            companyId,
            parentId,
          });
          setUploadModalState({ parent_id: '', open: false });
        }}
      />
      <CreateModal
        selectFolderFromDevice={() => uploadFolderZoneRef.current?.open()}
        selectFromDevice={() => uploadZoneRef.current?.open()}
        addFromUrl={(url, name) => {
          setCreationModalState({ parent_id: '', open: false });
          uploadFromUrl(url, name, {
            companyId,
            parentId,
          });
        }}
      />
      <UploadModal
        selectFolderFromDevice={() => uploadFolderZoneRef.current?.open()}
        selectFromDevice={() => uploadZoneRef.current?.open()}
        addFromUrl={(url, name) => {
          setUploadModalState({ parent_id: '', open: false });
          uploadFromUrl(url, name, {
            companyId,
            parentId,
          });
        }}
      />
    </>
  );
};

export default () => {
  const { user } = useCurrentUser();
  const { viewId, dirId } = useRouteState();
  const [ parentId ] = useRecoilState(DriveCurrentFolderAtom({ initialFolderId: dirId || viewId || 'user_'+user?.id  }));
  const { access, item } = useDriveItem(parentId);
  const { children: trashChildren } = useDriveItem(viewId === 'trash' ? 'trash' : 'trash_'+user?.id);
  const uploadZoneRef = useRef<UploadZone | null>(null);
  const { uploadTree } = useDriveUpload();
  const companyId = useRouterCompany();
  const history = useHistory();
  const inTrash = viewId?.includes("trash") || false;
  
  // Détecter si on est dans Dropbox ou Google Drive
  const isInCloudProvider = parentId?.startsWith('dropbox_') || parentId?.startsWith('googledrive_');
  
  // Détecter si on est dans le Drive partagé (root), Partagé avec moi, ou Corbeille
  const isInSharedDrive = viewId === 'root' || parentId === 'root';
  const isInSharedWithMe = viewId === 'shared_with_me';
  const shouldHideCreateButton = isInSharedDrive || isInSharedWithMe || inTrash;

  const setConfirmDeleteModalState = useSetRecoilState(ConfirmDeleteModalAtom);
  const setCreationModalState = useSetRecoilState(CreateModalAtom);
  const setUploadModalState = useSetRecoilState(UploadModelAtom);

  const openItemModal = useCallback(() => {
    // Si on est dans Dropbox/Google Drive, rediriger vers Mon drive
    if (isInCloudProvider) {
      history.push(`/client/${companyId}/v/user_${user?.id}`);
      // Ouvrir le modal après la redirection
      setTimeout(() => {
        setCreationModalState({ open: true, parent_id: 'user_'+user?.id });
      }, 100);
    } else if (item?.id) {
      setCreationModalState({ open: true, parent_id: item.id });
    }
  }, [item?.id, isInCloudProvider, user?.id, companyId, history, setCreationModalState]);

  const uploadItemModal = useCallback(() => {
    // Si on est dans Dropbox/Google Drive, rediriger vers Mon drive
    if (isInCloudProvider) {
      history.push(`/client/${companyId}/v/user_${user?.id}`);
      // Ouvrir le modal après la redirection
      setTimeout(() => {
        setUploadModalState({ open: true, parent_id: 'user_'+user?.id });
      }, 100);
    } else if (item?.id) {
      setUploadModalState({ open: true, parent_id: item.id });
    }
  }, [item?.id, isInCloudProvider, user?.id, companyId, history, setUploadModalState]);

  return (
    <div className="-m-4 overflow-hidden testid:sidebar-actions">
      <AnimatedHeight>
        <div className="p-4">
          <CreateModalWithUploadZones initialParentId={parentId} />

          {/* Boutons Télécharger et Créer - TOUJOURS VISIBLES */}
          <UploadZone
            overClassName={'!hidden'}
            className="hidden"
            disableClick
            parent={''}
            multiple={true}
            ref={uploadZoneRef}
            driveCollectionKey={'side-menu'}
            onAddFiles={async (_, event) => {
              const tree = await getFilesTree(event);
              setCreationModalState({ parent_id: '', open: false });
              uploadTree(tree, {
                companyId,
                parentId,
              });
            }}
            testClassId="sidebar-action-upload-zone"
          />

          <Button
            onClick={() => uploadItemModal()}
            shortcut='U'
            size="lg"
            theme="primary"
            className="w-full mb-2 justify-center"
            style={{ boxShadow: '0 0 10px 0 rgba(0, 122, 255, 0.5)' }}
            testClassId="button-upload"
          >
            <UploadIcon className="w-5 h-5 mr-2" /> {Languages.t('components.side_menu.buttons.upload')}
          </Button>
          {!shouldHideCreateButton && (
            <Button
              onClick={() => openItemModal()}
              shortcut='C'
              size="lg"
              theme="secondary"
              className="w-full mb-2 justify-center"
              testClassId="button-open-create-modal"
            >
              <PlusIcon className="w-5 h-5 mr-2" /> {Languages.t('components.side_menu.buttons.create')}
            </Button>
          )}

          {/* Bouton Supprimer - UNIQUEMENT dans la Corbeille */}
          {inTrash && (
            <Button
              onClick={() =>
                setConfirmDeleteModalState({
                  open: true,
                  items: trashChildren,
                })
              }
              size="lg"
              theme="danger"
              className="w-full mb-2 justify-center"
              disabled={!(trashChildren.length > 0)}
              testClassId="create-modal-in-trash-button-empty-trash"
            >
              <TrashIcon className="w-5 h-5 mr-2" /> { Languages.t('components.side_menu.buttons.empty_trash') }
            </Button>
          )}
        </div>
      </AnimatedHeight>
    </div>
  );
};
