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
          const driveItemsRaw: DriveItem[] = data.map((file: any) => {
            const filePath = file.path ?? file.Path ?? '';
            const fileName = file.name ?? file.Name ?? (filePath?.split('/')?.pop() ?? '');
            // Construire le chemin complet pour l'affichage/navigation
            const fullPath = path ? `${path}/${filePath}` : filePath;
            // ID stable basé sur l'ID renvoyé par le provider/rclone, sinon fallback sur le path
            const rawId = file.id ?? file.ID ?? filePath ?? fullPath;
            // Normaliser la taille: éviter les tailles négatives (-1) qui peuvent casser des renders/formatters
            const normalizedSize = Math.max(0, Number(file.size ?? file.Size ?? 0));
            const isDir = Boolean(file.is_directory ?? file.IsDir ?? false);
            const mime = file.mime_type ?? (isDir ? 'inode/directory' : 'application/octet-stream');
            // Utiliser un ID basé sur le chemin pour supporter la navigation par répertoires
            const itemId = `${provider}_${fullPath || (isDir ? fileName : fileName)}`;
            const parentId = path ? `${provider}_${path}` : `${provider}_root`;
            const extension = (fileName && fileName.includes('.')) ? (fileName.split('.').pop() || '') : '';

            return {
              id: itemId,
              name: fileName,
              size: normalizedSize,
              is_directory: isDir,
              parent_id: parentId,
              company_id: '',
              workspace_id: '',
              is_in_trash: false,
              extension,
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
                id: `${itemId}_v1`,
                provider: provider,
                drive_item_id: itemId,
                date_added: Date.now(),
                creator_id: '',
                application_id: '',
                file_metadata: {
                  source: provider,
                  external_id: rawId,
                  name: fileName,
                  mime,
                  size: normalizedSize,
                },
              },
            };
          });

          // Assurer l'unicité des IDs pour éviter tout conflit dans le store/render
          const seen = new Set<string>();
          const driveItems: DriveItem[] = driveItemsRaw.map((it, idx) => {
            let id = it.id;
            if (seen.has(id)) {
              id = `${id}__${idx}`;
            }
            seen.add(id);
            return { ...it, id, last_version_cache: { ...it.last_version_cache, id: `${id}_v1`, drive_item_id: id } };
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

          // Pour éviter des freezes sur d'énormes listes, limiter les écritures par enfant
          const MAX_CHILD_ATOMS = 500;
          if (driveItems.length <= MAX_CHILD_ATOMS) {
            for (const child of driveItems) {
              set(DriveItemAtom(child.id), { item: child });
            }
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
