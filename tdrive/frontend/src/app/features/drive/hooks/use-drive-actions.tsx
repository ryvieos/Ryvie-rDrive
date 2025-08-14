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
      // Afficher une notification que le téléchargement est en préparation
      const messageText = fileName 
        ? Languages.t('hooks.use-drive-actions.preparing_file_with_name', [fileName]) 
        : Languages.t('hooks.use-drive-actions.preparing_file');
      
      // Utiliser message.loading qui retourne une fonction pour fermer le message
      const hideLoading = ToasterService.loading(messageText, 0);
      
      // Récupérer le JWT et créer l'en-tête d'autorisation
      const jwt = jwtStorageService.getJWT();
      const authHeader = `Bearer ${jwt}`;

      // Utiliser fetch avec les en-têtes d'authentification et les cookies
      fetch(fileUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: authHeader,
        },
      })
        .then(response => {
          if (!response.ok) {
            // Fermer la notification en cas d'erreur
            hideLoading();
            throw new Error(`Erreur HTTP: ${response.status}`);
          }
          
          // Extraire le nom du fichier de l'en-tête Content-Disposition s'il existe
          let extractedFileName = fileName;
          const contentDisposition = response.headers.get('Content-Disposition');
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
              extractedFileName = filenameMatch[1].replace(/['"]/g, '');
            }
          }
          
          // Utiliser le nom fourni, extrait ou généré à partir de l'URL
          if (!extractedFileName) {
            extractedFileName = fileUrl.split('/').pop()?.split('?')[0] || 'download';
          }
          
          return response.blob().then(blob => ({ blob, fileName: extractedFileName }));
        })
        .then(({ blob, fileName }) => {
          const url = window.URL.createObjectURL(blob);
          const downloadLink = document.createElement('a');
          downloadLink.href = url;
          
          // Utiliser le nom du fichier correct (avec valeur par défaut pour éviter undefined)
          downloadLink.download = fileName || 'download';
          
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
          window.URL.revokeObjectURL(url);
          
          // Fermer la notification de préparation et afficher une notification de succès
          hideLoading();
          ToasterService.success(
            fileName 
              ? Languages.t('hooks.use-drive-actions.download_complete_with_name', [fileName])
              : Languages.t('hooks.use-drive-actions.download_complete')
          );
        })
        .catch(error => {
          // Fermer la notification en cas d'erreur
          hideLoading();
          Logger.error('Erreur lors du téléchargement:', error);
          ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
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
          
          // Déterminer un nom de fichier approprié pour le ZIP
          let zipFileName = 'archive.zip';
          let displayName = 'archive';
          let hideLoading: () => void = () => {};
          
          if (ids.length === 1) {
            // Si c'est un seul dossier/fichier, on utilise son nom
            try {
              const itemDetails = await DriveApiClient.get(companyId, ids[0]);
              // Accéder au nom en utilisant la structure correcte de DriveItemDetails
              if (itemDetails && itemDetails.item && itemDetails.item.name) {
                displayName = itemDetails.item.name;
                zipFileName = `${displayName}.zip`;
              }
            } catch (e) {
              Logger.error('Erreur lors de la récupération des détails du dossier:', e);
            }
          } else if (ids.length > 1) {
            displayName = Languages.t('hooks.use-drive-actions.multiple_files', [ids.length]);
          }
          
          // Afficher une notification de préparation du téléchargement
          const messageText = isDirectory 
            ? Languages.t('hooks.use-drive-actions.preparing_folder_with_name', [displayName]) 
            : Languages.t('hooks.use-drive-actions.preparing_files_with_count', [ids.length]);
          
          hideLoading = ToasterService.loading(messageText, 0);
          
          Logger.debug('Téléchargement du ZIP avec nom:', zipFileName);
          
          // Obtenir l'URL de téléchargement
          const url = await DriveApiClient.getDownloadZipUrl(companyId, ids, isDirectory);
          
          // Télécharger le ZIP avec le nom approprié (sans notifications car on les gère ici)
          try {
            // Récupérer le JWT et créer l'en-tête d'autorisation
            const jwt = jwtStorageService.getJWT();
            const authHeader = `Bearer ${jwt}`;

            // Utiliser fetch avec les en-têtes d'authentification et les cookies
            fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: {
                Authorization: authHeader,
              },
            })
              .then(response => {
                if (!response.ok) {
                  hideLoading();
                  throw new Error(`Erreur HTTP: ${response.status}`);
                }
                return response.blob();
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
                
                // Fermer la notification de préparation et afficher une notification de succès
                hideLoading();
                ToasterService.success(
                  isDirectory 
                    ? Languages.t('hooks.use-drive-actions.download_folder_complete', [displayName])
                    : Languages.t('hooks.use-drive-actions.download_files_complete', [ids.length])
                );
              })
              .catch(error => {
                hideLoading();
                Logger.error('Erreur lors du téléchargement ZIP:', error);
                ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
              });
          } catch (e) {
            hideLoading();
            Logger.error('Erreur lors du téléchargement ZIP:', e);
            ToasterService.error(Languages.t('hooks.use-drive-actions.unable_download_file'));
          }
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
        if (previousName && previousName !== newItem.name && !update.name)
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
