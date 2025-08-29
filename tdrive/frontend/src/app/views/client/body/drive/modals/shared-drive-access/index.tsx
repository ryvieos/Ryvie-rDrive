import { Modal, ModalContent } from '@atoms/modal';
import { useDriveItem } from '@features/drive/hooks/use-drive-item';
import { useEffect, useState } from 'react';
import { atom, useRecoilState } from 'recoil';
import { useCurrentCompany } from '@features/companies/hooks/use-companies';
import Languages from 'features/global/services/languages-service';
import { DriveItem } from '@features/drive/types';
import { useDriveActions } from '@features/drive/hooks/use-drive-actions';
import { ToasterService } from '@features/global/services/toaster-service';

export type SharedDriveModalType = {
  open: boolean;
  id: string;
  ids?: string[];
};

export const SharedDriveModalAtom = atom<SharedDriveModalType>({
  key: 'SharedDriveModalAtom',
  default: {
    open: false,
    id: '',
  },
});

export const SharedDriveModal = () => {
  const [state, setState] = useRecoilState(SharedDriveModalAtom);
  const closeModal = () => setState({ ...state, open: false });
  return (
    <Modal
      open={state.open}
      className='!overflow-visible testid:shared-drive-modal'
      onClose={closeModal}
      >
      {!!state.id && <SharedDriveModalContent id={state.id} ids={state.ids} onCloseModal={closeModal} />}
    </Modal>
  );
};

const SharedDriveModalContent = (props: {
  id: string,
  ids?: string[],
  onCloseModal: () => void,
}) => {
  const { id, ids } = props;
  const { item, loading, refresh } = useDriveItem(id);
  const { update } = useDriveActions();
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    refresh(id);
  }, [id, refresh]);

  // Vérifier si le fichier est déjà partagé dans le Shared Drive
  const currentAccessInfo = item?.access_info || { entities: [] };
  const sharedDriveEntity = currentAccessInfo.entities?.find(entity => 
    entity.type === "folder" && entity.id === "shared_drive"
  );
  const isSharedInSharedDrive = !!sharedDriveEntity;
  const currentSharedDriveLevel = sharedDriveEntity?.level || 'read';

  const shareToSharedDrive = async (accessLevel: 'read' | 'write' | 'manage') => {
    if (!item) return;

    setIsUpdating(true);
    try {
      const targets = (ids && ids.length ? ids : [id]);
      ToasterService.info(`Partage vers Shared Drive en cours (${accessLevel}) pour ${targets.length} élément(s)...`);
      
      // Ajouter ou mettre à jour l'entité "shared_drive" aux permissions existantes
      const buildUpdated = (current: DriveItem['access_info']) => ({
        ...current,
        entities: [
          ...(current?.entities?.filter(entity => !(entity.type === 'folder' && entity.id === 'shared_drive')) || []),
          { type: 'folder' as const, id: 'shared_drive', level: accessLevel },
        ],
      });

      for (const targetId of targets) {
        // If first item, we already have currentAccessInfo; others will rely on minimal update
        const current = targetId === id ? currentAccessInfo : { entities: [] };
        const updatedAccess = buildUpdated(current as any);
        await update(
          { access_info: updatedAccess },
          targetId,
          item.parent_id,
          item.name,
        );
      }
      
      const accessLevelText = {
        read: 'lecture seule',
        write: 'lecture et écriture', 
        manage: 'gestion complète'
      }[accessLevel];
      
      ToasterService.success(`${targets.length} élément(s) partagé(s) dans Shared Drive avec accès ${accessLevelText}.`);
      await refresh(id); // Rafraîchir les données de l'élément affiché
    } catch (error) {
      console.error('Error sharing to Shared Drive:', error);
      ToasterService.error(`Erreur lors du partage dans Shared Drive.`);
    } finally {
      setIsUpdating(false);
    }
  };

  const removeFromSharedDrive = async () => {
    if (!item) return;
    
    setIsUpdating(true);
    try {
      const targets = (ids && ids.length ? ids : [id]);
      ToasterService.info(`Suppression du partage Shared Drive en cours pour ${targets.length} élément(s)...`);
      
      const buildUpdated = (current: DriveItem['access_info']) => ({
        ...current,
        entities: current?.entities?.filter(entity => !(entity.type === 'folder' && entity.id === 'shared_drive')) || [],
      });

      for (const targetId of targets) {
        const current = targetId === id ? currentAccessInfo : { entities: [] };
        const updatedAccess = buildUpdated(current as any);
        await update(
          { access_info: updatedAccess },
          targetId,
          item.parent_id,
          item.name,
        );
      }
      
      ToasterService.success(`${targets.length} élément(s) retiré(s) du Shared Drive.`);
      await refresh(id); // Rafraîchir les données de l'élément affiché
    } catch (error) {
      console.error('Error removing from Shared Drive:', error);
      ToasterService.error(`Erreur lors de la suppression du Shared Drive.`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <ModalContent
      title={
          <>
            {'Partage Shared Drive - '}
            <strong>{(ids && ids.length > 1) ? `${ids.length} éléments` : item?.name}</strong>
          </>
        }
      >
      <div className={loading || isUpdating ? 'opacity-50' : ''}>
        <div className="space-y-4">
          {isSharedInSharedDrive ? (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Ce fichier est actuellement partagé dans le Shared Drive avec un accès <strong>{currentSharedDriveLevel === 'read' ? 'lecture seule' : currentSharedDriveLevel === 'write' ? 'lecture et écriture' : 'gestion complète'}</strong>.
              </p>
              
              <div className="space-y-2">
                <h3 className="font-medium">Modifier le niveau d'accès :</h3>
                <div className="flex flex-col space-y-2">
                  {currentSharedDriveLevel !== 'read' && (
                    <button
                      onClick={() => shareToSharedDrive('read')}
                      disabled={isUpdating}
                      className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                    >
                      <span>👁️</span>
                      <span>Lecture seule</span>
                    </button>
                  )}
                  {currentSharedDriveLevel !== 'write' && (
                    <button
                      onClick={() => shareToSharedDrive('write')}
                      disabled={isUpdating}
                      className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                    >
                      <span>✏️</span>
                      <span>Lecture et écriture</span>
                    </button>
                  )}
                  {currentSharedDriveLevel !== 'manage' && (
                    <button
                      onClick={() => shareToSharedDrive('manage')}
                      disabled={isUpdating}
                      className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                    >
                      <span>⚙️</span>
                      <span>Gestion complète</span>
                    </button>
                  )}
                </div>
                
                <div className="border-t pt-4 mt-4">
                  <button
                    onClick={removeFromSharedDrive}
                    disabled={isUpdating}
                    className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-red-100 text-red-600 rounded"
                  >
                    <span>🗑️</span>
                    <span>Retirer du Shared Drive</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Choisissez le niveau d'accès pour partager ce fichier dans le Shared Drive :
              </p>
              
              <div className="flex flex-col space-y-2">
                <button
                  onClick={() => shareToSharedDrive('read')}
                  disabled={isUpdating}
                  className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                >
                  <span>👁️</span>
                  <span>Lecture seule</span>
                </button>
                <button
                  onClick={() => shareToSharedDrive('write')}
                  disabled={isUpdating}
                  className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                >
                  <span>✏️</span>
                  <span>Lecture et écriture</span>
                </button>
                <button
                  onClick={() => shareToSharedDrive('manage')}
                  disabled={isUpdating}
                  className="flex items-center space-x-2 px-3 py-2 text-left hover:bg-gray-100 rounded"
                >
                  <span>⚙️</span>
                  <span>Gestion complète</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalContent>
  );
};
