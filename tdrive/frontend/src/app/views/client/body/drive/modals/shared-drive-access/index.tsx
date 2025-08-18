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
      {!!state.id && <SharedDriveModalContent id={state.id} onCloseModal={closeModal} />}
    </Modal>
  );
};

const SharedDriveModalContent = (props: {
  id: string,
  onCloseModal: () => void,
}) => {
  const { id } = props;
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
      ToasterService.info(`Partage vers Shared Drive en cours (${accessLevel})...`);
      
      // Ajouter ou mettre à jour l'entité "shared_drive" aux permissions existantes
      const updatedAccess = {
        ...currentAccessInfo,
        entities: [
          ...(currentAccessInfo.entities?.filter(entity => 
            !(entity.type === "folder" && entity.id === "shared_drive")
          ) || []),
          {
            type: "folder" as const,
            id: "shared_drive",
            level: accessLevel,
          }
        ]
      };
      
      await update(
        {
          access_info: updatedAccess,
        },
        item.id,
        item.parent_id,
        item.name
      );
      
      const accessLevelText = {
        read: 'lecture seule',
        write: 'lecture et écriture', 
        manage: 'gestion complète'
      }[accessLevel];
      
      ToasterService.success(`"${item.name}" partagé dans Shared Drive avec accès ${accessLevelText}.`);
      await refresh(id); // Rafraîchir les données
    } catch (error) {
      console.error('Error sharing to Shared Drive:', error);
      ToasterService.error(`Erreur lors du partage de "${item.name}" dans Shared Drive.`);
    } finally {
      setIsUpdating(false);
    }
  };

  const removeFromSharedDrive = async () => {
    if (!item) return;
    
    setIsUpdating(true);
    try {
      ToasterService.info('Suppression du partage Shared Drive en cours...');
      
      // Supprimer l'entité "shared_drive" des permissions
      const updatedAccess = {
        ...currentAccessInfo,
        entities: currentAccessInfo.entities?.filter(entity => 
          !(entity.type === "folder" && entity.id === "shared_drive")
        ) || []
      };
      
      await update(
        {
          access_info: updatedAccess,
        },
        item.id,
        item.parent_id,
        item.name
      );
      
      ToasterService.success(`"${item.name}" retiré du Shared Drive.`);
      await refresh(id); // Rafraîchir les données
    } catch (error) {
      console.error('Error removing from Shared Drive:', error);
      ToasterService.error(`Erreur lors de la suppression de "${item.name}" du Shared Drive.`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <ModalContent
      title={
          <>
            {'Partage Shared Drive - '}
            <strong>{item?.name}</strong>
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
