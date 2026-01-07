import { ToasterService } from '@features/global/services/toaster-service';
import useRouterCompany from '@features/router/hooks/use-router-company';
import { useCallback } from 'react';
import { useRecoilValue, useRecoilCallback, useRecoilState } from 'recoil';
import { DriveApiClient } from '../api-client/api-client';
import {
  DriveItemAtom,
  DriveItemChildrenAtom,
  DriveItemPagination,
  DriveItemSort,
} from '../state/store';
import { BrowseFilter, DriveItem, DriveItemDetails, DriveItemVersion } from '../types';
import { SharedWithMeFilterState } from '../state/shared-with-me-filter';
import Languages from 'features/global/services/languages-service';
import { useUserQuota } from 'features/users/hooks/use-user-quota';
import AlertManager from 'app/features/global/services/alert-manager-service';
import FeatureTogglesService, {
  FeatureNames,
} from '@features/global/services/feature-toggles-service';
import Logger from '@features/global/framework/logger-service';
import jwtStorageService from '@features/auth/jwt-storage-service';
import { useCloudFiles } from './use-cloud-files';
import FileDownloadService from '@features/files/services/file-download-service';

/**
 * Returns the children of a drive item
 * @returns
 */
export const useDriveActions = (inPublicSharing?: boolean) => {
  const companyId = useRouterCompany();
  const sharedFilter = useRecoilValue(SharedWithMeFilterState);
  const sortItem = useRecoilValue(DriveItemSort);
  const [paginateItem] = useRecoilState(DriveItemPagination);
  const { getQuota } = useUserQuota();
  const AVEnabled = FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_AV_ENABLED);
  const { refreshDropboxFiles, refreshGoogleDriveFiles } = useCloudFiles();

  /**
   * Downloads a file from the given URL, ensuring compatibility across all browsers, including Safari.
   *
   * @param fileUrl - The URL of the file to download.
   * @param fileName - The name of the file to download.
   */
  const downloadFile = (fileUrl: string, fileName?: string) => {
    try {
      // Générer un ID unique pour ce téléchargement
      const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Extraire le nom du fichier si non fourni
      const finalFileName = fileName || fileUrl.split('/').pop()?.split('?')[0] || 'download';
      
      // Récupérer le JWT et créer l'en-tête d'autorisation
      const jwt = jwtStorageService.getJWT();
      const authHeader = `Bearer ${jwt}`;
      
      // Créer un AbortController pour permettre l'annulation
      const abortController = new AbortController();

      // Utiliser fetch avec les en-têtes d'authentification
      fetch(fileUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
        signal: abortController.signal,
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
          }
          
          // Extraire le nom du fichier de l'en-tête Content-Disposition s'il existe
          let extractedFileName = finalFileName;
          const contentDisposition = response.headers.get('Content-Disposition');
          Logger.debug('Content-Disposition header:', contentDisposition);
          if (contentDisposition) {
            // Essayer d'abord filename*=UTF-8'' (RFC 5987)
            let filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (filenameMatch && filenameMatch[1]) {
              extractedFileName = decodeURIComponent(filenameMatch[1]);
              Logger.debug('Extracted filename from UTF-8 encoding:', extractedFileName);
            } else {
              // Sinon essayer filename="..." ou filename=...
              filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/i);
              if (filenameMatch && filenameMatch[1]) {
                extractedFileName = filenameMatch[1].trim();
                Logger.debug('Extracted filename from standard format:', extractedFileName);
              }
            }
          }
          Logger.debug('Final filename for download:', extractedFileName);
          
          // Obtenir la taille du fichier
          const contentLength = response.headers.get('Content-Length');
          const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
          
          // Ajouter le téléchargement au service
          FileDownloadService.addDownload(downloadId, extractedFileName, totalSize, fileUrl, abortController);
          
          // Lire le flux de réponse avec suivi de progression
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let receivedLength = 0;
          
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;
              
              chunks.push(value);
              receivedLength += value.length;
              
              // Mettre à jour la progression
              FileDownloadService.updateProgress(downloadId, receivedLength);
            }
          }
          
          // Créer le blob à partir des chunks
          const blob = new Blob(chunks);
          return { blob, fileName: extractedFileName };
        })
        .then(({ blob, fileName }) => {
          const url = window.URL.createObjectURL(blob);
          const downloadLink = document.createElement('a');
          downloadLink.href = url;
          downloadLink.download = fileName || 'download';
          
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
          window.URL.revokeObjectURL(url);
          
          // Marquer le téléchargement comme terminé
          FileDownloadService.completeDownload(downloadId);
        })
        .catch(error => {
          if (error.name === 'AbortError') {
            Logger.info('Téléchargement annulé par l\'utilisateur');
          } else {
            Logger.error('Erreur lors du téléchargement:', error);
            FileDownloadService.failDownload(downloadId);
            ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
          }
        });
    } catch (e) {
      ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
    }
  };

  const refresh = useRecoilCallback(
    ({ set, snapshot }) =>
      async (parentId: string, resetPagination?: boolean) => {
        if (parentId) {
          // Détecter si c'est un identifiant Dropbox
          if (parentId.startsWith('dropbox_')) {
            let dropboxPath;
            if (parentId === 'dropbox_root') {
              dropboxPath = '';
            } else {
              // Extraire le chemin en supprimant le préfixe 'dropbox_'
              dropboxPath = parentId.replace('dropbox_', '');
            }
            return await refreshDropboxFiles(dropboxPath);
          }
          
          // Gestion spéciale pour Google Drive
          if (parentId.startsWith('googledrive_')) {
            let googleDrivePath;
            if (parentId === 'googledrive_root') {
              googleDrivePath = '';
            } else {
              // Extraire le chemin en supprimant le préfixe 'googledrive_'
              googleDrivePath = parentId.replace('googledrive_', '');
            }
            return await refreshGoogleDriveFiles(googleDrivePath);
          }
          
          const filter: BrowseFilter = {
            company_id: companyId,
            mime_type: sharedFilter.mimeType.value,
          };
          
          // Debug: Log filter for Shared Drive
          if (parentId === 'root') {
            console.log('🔍 FRONTEND DEBUG: Browsing Shared Drive with filter:', filter);
            console.log('🔍 FRONTEND DEBUG: sharedFilter.mimeType.value:', sharedFilter.mimeType.value);
          }
          let pagination = await snapshot.getPromise(DriveItemPagination);

          if (resetPagination) {
            pagination = { page: 0, limit: pagination.limit, nextPage: pagination.nextPage };
            set(DriveItemPagination, pagination);
          }
          let details: DriveItemDetails | undefined;
          
          // Garde préventive : éviter les appels avec company ID vide
          if (!companyId || companyId.trim() === '') {
            console.warn('Company ID is empty, skipping API call to avoid 404');
            return; // Sortir silencieusement sans erreur
          }
          
          try {
            details = await DriveApiClient.browse(
              companyId,
              parentId,
              filter,
              sortItem,
              pagination,
            );
            set(DriveItemChildrenAtom(parentId), details.children);
            set(DriveItemAtom(parentId), details);
            for (const child of details.children) {
              const currentValue = snapshot.getLoadable(DriveItemAtom(child.id)).contents;
              if (!currentValue) {
                //only update if not already in cache to avoid concurrent updates
                set(DriveItemAtom(child.id), { item: child });
              }
            }
            return details;
          } catch (e) {
            // Filtrer les erreurs temporaires lors de la connexion initiale
            const errorString = e?.toString?.() || '';
            const isConnectionError = errorString.includes('404') || errorString.includes('NetworkError');
            const isInitialLoad = !details || Object.keys(details).length === 0;
            const hasEmptyCompanyId = window.location.href.includes('//browse/') || window.location.href.includes('/companies//');
            
            // Délai de grâce de 10 secondes après le chargement de la page
            const pageLoadTime = window.performance?.timing?.navigationStart || Date.now();
            const isWithinGracePeriod = (Date.now() - pageLoadTime) < 10000;
            
            const isTemporaryError = isConnectionError && (isInitialLoad || hasEmptyCompanyId || isWithinGracePeriod);
            
            if (!isTemporaryError) {
              ToasterService.error(Languages.t('hooks.use-drive-actions.unable_load_file'));
            } else {
              console.warn('Temporary connection error during authentication, ignoring:', e);
            }
          } finally {
            set(DriveItemPagination, {
              page: pagination.limit,
              limit: pagination.limit,
              nextPage: {
                page_token: details?.nextPage?.page_token || '',
              },
            });
          }
        }
      },
    [companyId, sortItem],
  );

  const create = useCallback(
    async (item: Partial<DriveItem>, version: Partial<DriveItemVersion>) => {
      if (!item || !version) throw new Error('All ');
      if (!item.company_id) item.company_id = companyId;

      try {
        const driveFile = await DriveApiClient.create(companyId, { item, version });

        await refresh(driveFile.parent_id, true);
        await getQuota();

        return driveFile;
      } catch (e: any) {
        if (e.statusCode === 403) {
          ToasterService.info(
            <>
              <p>{Languages.t('hooks.use-drive-actions.quota_limit_exceeded_title')}</p>
              <p>{Languages.t('hooks.use-drive-actions.quota_limit_exceeded_message')}</p>
              <p>{Languages.t('hooks.use-drive-actions.quota_limit_exceeded_plans')}</p>
            </>,
          );
        } else {
          ToasterService.error(Languages.t('hooks.use-drive-actions.unable_create_file'));
        }
        return null;
      }
    },
    [refresh],
  );

  const download = useCallback(
    async (id: string, isMalicious = false, versionId?: string) => {
      try {
        const url = DriveApiClient.getDownloadUrl(companyId, id, versionId);
        // if AV is enabled
        if (AVEnabled) {
          // if the file is malicious
          if (isMalicious) {
            // toggle confirm for user
            AlertManager.confirm(
              () => {
                downloadFile(url);
              },
              () => {
                return;
              },
              {
                text: Languages.t('hooks.use-drive-actions.av_confirm_file_download'),
              },
            );
          } else {
            downloadFile(url);
          }
        } else {
          downloadFile(url);
        }
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
      }
    },
    [companyId],
  );

  const downloadZip = useCallback(
    async (ids: string[], isDirectory = false, containsMalicious = false) => {
      try {
        Logger.debug('Téléchargement ZIP demandé:', { ids, isDirectory });
        
        const triggerDownload = async () => {
          Logger.debug('Lancement du téléchargement ZIP');
          
          // Déterminer un nom de fichier approprié pour le ZIP et calculer la taille totale
          let zipFileName = 'rDrive.zip';
          let displayName = 'rDrive';
          let estimatedTotalSize = 0;
          
          // Récupérer les détails de tous les fichiers pour calculer la taille totale
          try {
            const itemsDetails = await Promise.all(
              ids.map(id => DriveApiClient.get(companyId, id).catch(e => {
                Logger.error('Erreur lors de la récupération des détails:', e);
                return null;
              }))
            );
            
            // Calculer la taille totale en additionnant les tailles de tous les fichiers
            for (const itemDetail of itemsDetails) {
              if (itemDetail && itemDetail.item) {
                estimatedTotalSize += itemDetail.item.size || 0;
              }
            }
            
            Logger.debug('Taille totale estimée des fichiers:', estimatedTotalSize);
            
            // Définir le nom du fichier
            if (ids.length === 1 && itemsDetails[0]?.item?.name) {
              displayName = itemsDetails[0].item.name;
              zipFileName = `${displayName}.zip`;
            } else if (ids.length > 1) {
              displayName = 'rDrive';
              zipFileName = 'rDrive.zip';
            }
          } catch (e) {
            Logger.error('Erreur lors du calcul de la taille totale:', e);
          }
          
          Logger.debug('Téléchargement du ZIP avec nom:', zipFileName);
          
          // Obtenir l'URL de téléchargement
          const url = await DriveApiClient.getDownloadZipUrl(companyId, ids, isDirectory);
          
          // Générer un ID unique pour ce téléchargement
          const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Récupérer le JWT et créer l'en-tête d'autorisation
          const jwt = jwtStorageService.getJWT();
          const authHeader = `Bearer ${jwt}`;
          
          // Créer un AbortController pour permettre l'annulation
          const abortController = new AbortController();

          // Utiliser fetch avec les en-têtes d'authentification
          fetch(url, {
            method: 'GET',
            headers: {
              Authorization: authHeader,
            },
            signal: abortController.signal,
          })
            .then(async response => {
              if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
              }
              
              // Obtenir la taille du fichier depuis le header, sinon utiliser la taille estimée
              const contentLength = response.headers.get('Content-Length');
              const totalSize = contentLength ? parseInt(contentLength, 10) : estimatedTotalSize;
              
              // Ajouter le téléchargement au service avec la taille estimée
              FileDownloadService.addDownload(downloadId, zipFileName, totalSize, url, abortController);
              
              // Lire le flux de réponse avec suivi de progression
              const reader = response.body?.getReader();
              const chunks: Uint8Array[] = [];
              let receivedLength = 0;
              
              if (reader) {
                while (true) {
                  const { done, value } = await reader.read();
                  
                  if (done) break;
                  
                  chunks.push(value);
                  receivedLength += value.length;
                  
                  // Mettre à jour la progression
                  FileDownloadService.updateProgress(downloadId, receivedLength);
                }
              }
              
              // Créer le blob à partir des chunks
              const blob = new Blob(chunks);
              return blob;
            })
            .then(blob => {
              const objectUrl = window.URL.createObjectURL(blob);
              const downloadLink = document.createElement('a');
              downloadLink.href = objectUrl;
              downloadLink.download = zipFileName;
              document.body.appendChild(downloadLink);
              downloadLink.click();
              document.body.removeChild(downloadLink);
              window.URL.revokeObjectURL(objectUrl);
              
              // Marquer le téléchargement comme terminé
              FileDownloadService.completeDownload(downloadId);
            })
            .catch(error => {
              if (error.name === 'AbortError') {
                Logger.info('Téléchargement ZIP annulé par l\'utilisateur');
              } else {
                Logger.error('Erreur lors du téléchargement ZIP:', error);
                FileDownloadService.failDownload(downloadId);
                ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
              }
            });
        };
        if (AVEnabled) {
          const containsMaliciousFiles =
            containsMalicious ||
            (ids.length === 1 && (await DriveApiClient.checkMalware(companyId, ids[0])));
          if (containsMaliciousFiles) {
            AlertManager.confirm(
              async () => {
                await triggerDownload();
              },
              () => {
                return;
              },
              {
                text: Languages.t('hooks.use-drive-actions.av_confirm_folder_download'),
              },
            );
          } else {
            await triggerDownload();
          }
        } else {
          await triggerDownload();
        }
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
      }
    },
    [companyId],
  );

  const remove = useCallback(
    async (id: string | string[], parentId: string) => {
      try {
        if (Array.isArray(id)) {
          await Promise.all(id.map(i => DriveApiClient.remove(companyId, i)));
        } else await DriveApiClient.remove(companyId, id);
        await refresh(parentId || '', true);
        await getQuota();
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_remove_file'));
      }
    },
    [refresh],
  );

  const restore = useCallback(
    async (id: string, parentId: string) => {
      try {
        await DriveApiClient.restore(companyId, id);
        await refresh(parentId || '', true);
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_restore_file'));
      }
    },
    [refresh],
  );

  const update = useCallback(
    async (update: Partial<DriveItem> & { is_update_access_to_share_link?: boolean }, id: string, parentId: string, previousName?: string) => {
      try {
        const newItem = await DriveApiClient.update(companyId, id, update);
        // Show rename warning only if this is not an access_info-only update
        const isAccessOnly = !!(update as any)?.access_info;
        if (previousName && previousName !== newItem.name && !update.name && !isAccessOnly)
          ToasterService.warn(
            Languages.t('hooks.use-drive-actions.update_caused_a_rename', [
              previousName,
              newItem.name,
            ]),
          );
        await refresh(id || '', true);
        if (!inPublicSharing) await refresh(parentId || '', true);
        if (update?.parent_id !== parentId) await refresh(update?.parent_id || '', true);
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_update_file'));
      }
    },
    [refresh],
  );

  const updateLevel = useCallback(
    async (id: string, userId: string, level: string) => {
      try {
        const updateBody = {
          company_id: companyId,
          user_id: userId,
          level: level,
        };
        await DriveApiClient.updateLevel(companyId, id, updateBody);
        await refresh(id || '', true);
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_update_file'));
      }
    },
    [refresh],
  );

  const nextPage = useRecoilCallback(
    ({ snapshot }) =>
      async (parentId: string) => {
        // Vérifier si c'est un dossier Dropbox
        if (parentId.startsWith('dropbox_')) {
          let dropboxPath: string;
          if (parentId === 'dropbox_root') {
            dropboxPath = '';
          } else {
            // Extraire le chemin en supprimant le préfixe 'dropbox_'
            dropboxPath = parentId.replace('dropbox_', '');
          }
          return await refreshDropboxFiles(dropboxPath);
        }
        
        // Vérifier si c'est un dossier Google Drive
        if (parentId.startsWith('googledrive_')) {
          let googleDrivePath: string;
          if (parentId === 'googledrive_root') {
            googleDrivePath = '';
          } else {
            // Extraire le chemin en supprimant le préfixe 'googledrive_'
            googleDrivePath = parentId.replace('googledrive_', '');
          }
          return await refreshGoogleDriveFiles(googleDrivePath);
        }
        
        // Utiliser l'API standard pour les autres dossiers
        const filter: BrowseFilter = {
          company_id: companyId,
          mime_type: sharedFilter.mimeType.value,
        };
        const pagination = await snapshot.getPromise(DriveItemPagination);
        const details = await DriveApiClient.browse(
          companyId,
          parentId,
          filter,
          sortItem,
          pagination,
        );
        return details;
      },
    [paginateItem, refresh, refreshDropboxFiles, refreshGoogleDriveFiles],
  );

  const checkMalware = useCallback(
    async (item: Partial<DriveItem>) => {
      try {
        await DriveApiClient.checkMalware(companyId, item.id || '');
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_rescan_file'));
      }
    },
    [refresh],
  );

  const reScan = useCallback(
    async (item: Partial<DriveItem>) => {
      try {
        await DriveApiClient.reScan(companyId, item.id || '');
        await refresh(item.parent_id || '', true);
      } catch (e) {
        ToasterService.error(Languages.t('hooks.use-drive-actions.unable_rescan_file'));
      }
    },
    [refresh],
  );

  return {
    create,
    refresh,
    download,
    downloadZip,
    remove,
    restore,
    update,
    updateLevel,
    reScan,
    checkMalware,
    nextPage,
  };
};
