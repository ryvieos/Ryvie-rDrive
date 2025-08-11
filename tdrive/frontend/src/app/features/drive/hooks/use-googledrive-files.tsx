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

const logger = Logger.getLogger('GoogleDriveFilesHook');

/**
 * Hook pour gérer les fichiers Google Drive via rclone
 */
export const useGoogleDriveFiles = () => {
  const { user } = useCurrentUser();
  
  const refreshGoogleDriveFiles = useRecoilCallback(
    ({ set }) =>
      async (path: string = '') => {
        try {
          // Vérifier que l'utilisateur est connecté
          if (!user?.email) {
            throw new Error('Utilisateur non connecté');
          }
          
          logger.info('📧 Récupération des fichiers Google Drive pour:', user.email);
          
          // Construire l'URL du backend dynamiquement avec provider=googledrive
          const backendUrl = window.location.protocol + '//' + window.location.hostname + ':4000';
          const response = await fetch(`${backendUrl}/api/v1/files/rclone/list?path=${encodeURIComponent(path)}&userEmail=${encodeURIComponent(user.email)}&provider=googledrive`, {
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
          
          // Transformer les fichiers rclone en format DriveItem
          const driveItems: DriveItem[] = data.map((file: any) => {
            // Construire le chemin complet pour l'ID
            const fullPath = path ? `${path}/${file.path}` : file.path;
            return {
              id: `googledrive_${fullPath}`,
              name: file.name,
              size: file.size || 0,
              is_directory: file.is_directory || false,
              parent_id: path ? `googledrive_${path}` : 'googledrive_root',
              company_id: '', // Pas applicable pour Google Drive
              workspace_id: '', // Pas applicable pour Google Drive
              is_in_trash: false,
              extension: file.name.includes('.') ? file.name.split('.').pop() || '' : '',
              description: '',
              tags: [],
              added: file.modified_at || new Date().toISOString(),
              last_modified: file.modified_at || new Date().toISOString(),
              scope: 'googledrive',
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
                provider: 'googledrive',
                drive_item_id: `googledrive_${fullPath}`,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: {
                  source: 'googledrive',
                  external_id: file.id || file.path,
                  name: file.name,
                  mime: file.mime_type || (file.is_directory ? 'inode/directory' : 'application/octet-stream'),
                  size: file.size || 0,
                },
              },
            };
          });
          
          // Créer l'item parent pour Google Drive
          const parentId = path ? `googledrive_${path}` : 'googledrive_root';
          const parentItem = {
            item: {
              id: parentId,
              name: path || 'Google Drive',
              is_directory: true,
              size: 0,
              parent_id: path ? 'googledrive_root' : '',
              company_id: '',
              workspace_id: '',
              is_in_trash: false,
              extension: '',
              description: 'Google Drive folder',
              tags: [],
              added: new Date().toISOString(),
              last_modified: new Date().toISOString(),
              scope: 'googledrive',
              av_status: 'clean',
              access_info: {
                public: { level: 'none' as any, token: '', password: '', expiration: 0 },
                entities: [],
              },
              last_version_cache: {
                id: `${parentId}_v1`,
                provider: 'googledrive',
                drive_item_id: parentId,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: { 
                  source: 'googledrive',
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
          logger.error('Failed to refresh Google Drive files:', error);
          // Ne pas afficher d'erreur toast pour éviter "unable to load more items"
          // Retourner un objet parent vide au lieu de throw
          const parentId = path ? `googledrive_${path}` : 'googledrive_root';
          const emptyParentItem = {
            item: {
              id: parentId,
              name: path || 'Google Drive',
              is_directory: true,
              size: 0,
              parent_id: path ? 'googledrive_root' : '',
              company_id: '',
              workspace_id: '',
              is_in_trash: false,
              extension: '',
              description: 'Google Drive folder',
              tags: [],
              added: new Date().toISOString(),
              last_modified: new Date().toISOString(),
              scope: 'googledrive',
              av_status: 'clean',
              access_info: {
                public: { level: 'none' as any, token: '', password: '', expiration: 0 },
                entities: [],
              },
              last_version_cache: {
                id: `${parentId}_v1`,
                provider: 'googledrive',
                drive_item_id: parentId,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: { 
                  source: 'googledrive',
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

  return {
    refreshGoogleDriveFiles,
  };
};
