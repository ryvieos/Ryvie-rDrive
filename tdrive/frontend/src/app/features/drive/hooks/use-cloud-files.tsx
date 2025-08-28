import { useCallback } from 'react';
import { useRecoilCallback } from 'recoil';
import { DriveItemAtom, DriveItemChildrenAtom } from '../state/store';
import { DriveItem, DriveItemDetails } from '../types';
import Api from '@features/global/framework/api-service';
import Logger from '@features/global/framework/logger-service';
import { ToasterService } from '@features/global/services/toaster-service';
import Languages from 'features/global/services/languages-service';
import { useCurrentUser } from '@features/users/hooks/use-current-user';
import JWTStorage from '@features/auth/jwt-storage-service';

const logger = Logger.getLogger('CloudFilesHook');

export type CloudProvider = 'dropbox' | 'googledrive';

/**
 * Hook unifié pour gérer les fichiers cloud (Dropbox/Google Drive) via rclone
 * REMPLACE use-googledrive-files.tsx et les parties Dropbox équivalentes
 */
export const useCloudFiles = () => {
  const { user } = useCurrentUser();
  
  const refreshCloudFiles = useRecoilCallback(
    ({ set }) =>
      async (path: string = '', provider: CloudProvider = 'dropbox') => {
        try {
          // Vérifier que l'utilisateur est connecté
          if (!user?.email) {
            throw new Error('Utilisateur non connecté');
          }
          
          logger.info(`📧 Récupération des fichiers ${provider} pour:`, user.email);
          
          // Utiliser un chemin relatif pour passer par Nginx (/api)
          const response = await fetch(`/api/v1/files/rclone/list?path=${encodeURIComponent(path)}&userEmail=${encodeURIComponent(user.email)}&provider=${provider}`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': JWTStorage.getAutorizationHeader()
            }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const data = await response.json();
          
          if (!Array.isArray(data)) {
            throw new Error('Invalid response format from rclone API');
          }
          
          // Transformer les fichiers rclone en format DriveItem (unifié pour les deux providers)
          const driveItems: DriveItem[] = data.map((file: any) => {
            // Construire le chemin complet pour l'ID
            const fullPath = path ? `${path}/${file.path}` : file.path;
            return {
              id: `${provider}_${fullPath}`,
              name: file.name,
              size: file.size || file.Size || 0,
              is_directory: file.is_directory || false,
              parent_id: path ? `${provider}_${path}` : `${provider}_root`,
              company_id: '', // Pas applicable pour les providers cloud
              workspace_id: '', // Pas applicable pour les providers cloud
              is_in_trash: false,
              extension: file.name.includes('.') ? file.name.split('.').pop() || '' : '',
              description: '',
              tags: [],
              added: file.modified_at || new Date().toISOString(),
              last_modified: file.modified_at || new Date().toISOString(),
              scope: provider,
              av_status: 'clean',
              access_info: {
                public: {
                  level: 'none' as any,
                  token: '',
                  password: '',
                  expiration: 0,
                },
                entities: [],
              },
              last_version_cache: {
                id: `${file.id || file.path}_v1`,
                provider: provider,
                drive_item_id: `${provider}_${fullPath}`,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: {
                  source: provider,
                  external_id: file.id || file.path,
                  name: file.name,
                  mime: file.mime_type || (file.is_directory ? 'inode/directory' : 'application/octet-stream'),
                  size: file.size || file.Size || 0,
                },
              },
            };
          });
          
          // Créer l'item parent pour le provider cloud
          const parentId = path ? `${provider}_${path}` : `${provider}_root`;
          const providerDisplayName = provider === 'googledrive' ? 'Google Drive' : 'Dropbox';
          const parentItem = {
            item: {
              id: parentId,
              name: path || providerDisplayName,
              is_directory: true,
              size: 0,
              parent_id: path ? `${provider}_root` : '',
              company_id: '',
              workspace_id: '',
              is_in_trash: false,
              extension: '',
              description: `${providerDisplayName} folder`,
              tags: [],
              added: new Date().toISOString(),
              last_modified: new Date().toISOString(),
              scope: provider,
              av_status: 'clean',
              access_info: {
                public: { level: 'none' as any, token: '', password: '', expiration: 0 },
                entities: [],
              },
              last_version_cache: {
                id: `${parentId}_v1`,
                provider: provider,
                drive_item_id: parentId,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: { 
                  source: provider,
                  external_id: parentId,
                },
              },
            } as DriveItem,
            versions: [],
            children: driveItems,
            path: [],
            access: 'read' as const,
            websockets: [],
            nextPage: undefined,
          };
          
          // Mettre à jour le store Recoil
          set(DriveItemAtom(parentId), parentItem);
          set(DriveItemChildrenAtom(parentId), driveItems);
          
          // Mettre à jour chaque enfant dans le store
          for (const child of driveItems) {
            set(DriveItemAtom(child.id), { item: child });
          }
          
          return parentItem;
          
        } catch (error) {
          logger.error(`Failed to refresh ${provider} files:`, error);
          // Ne pas afficher d'erreur toast pour éviter "unable to load more items"
          // Retourner un objet parent vide au lieu de throw
          const parentId = path ? `${provider}_${path}` : `${provider}_root`;
          const providerDisplayName = provider === 'googledrive' ? 'Google Drive' : 'Dropbox';
          const emptyParentItem = {
            item: {
              id: parentId,
              name: path || providerDisplayName,
              is_directory: true,
              size: 0,
              parent_id: path ? `${provider}_root` : '',
              company_id: '',
              workspace_id: '',
              is_in_trash: false,
              extension: '',
              description: `${providerDisplayName} folder`,
              tags: [],
              added: new Date().toISOString(),
              last_modified: new Date().toISOString(),
              scope: provider,
              av_status: 'clean',
              access_info: {
                public: { level: 'none' as any, token: '', password: '', expiration: 0 },
                entities: [],
              },
              last_version_cache: {
                id: `${parentId}_v1`,
                provider: provider,
                drive_item_id: parentId,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: { 
                  source: provider,
                  external_id: parentId,
                },
              },
            } as DriveItem,
            versions: [],
            children: [],
            path: [],
            access: 'read' as const,
            websockets: [],
            nextPage: undefined,
          };
          
          // Mettre à jour le store avec un dossier vide
          set(DriveItemAtom(parentId), emptyParentItem);
          set(DriveItemChildrenAtom(parentId), []);
          
          return emptyParentItem;
        }
      },
    [],
  );

  // Wrappers pour compatibilité avec le code existant
  const refreshDropboxFiles = useCallback(
    (path: string = '') => refreshCloudFiles(path, 'dropbox'),
    [refreshCloudFiles]
  );

  const refreshGoogleDriveFiles = useCallback(
    (path: string = '') => refreshCloudFiles(path, 'googledrive'),
    [refreshCloudFiles]
  );

  return {
    refreshCloudFiles,
    refreshDropboxFiles,
    refreshGoogleDriveFiles,
  };
};
