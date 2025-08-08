import { useCallback, useState } from 'react';
import { DriveApiClient } from '../api-client/api-client';
import { useDriveActions } from './use-drive-actions';
import { useCurrentUser } from 'app/features/users/hooks/use-current-user';
import useRouterCompany from '@features/router/hooks/use-router-company';
import { ToasterService } from '@features/global/services/toaster-service';
import Logger from '@features/global/framework/logger-service';
import Api from '@features/global/framework/api-service';

const logger = Logger.getLogger('GoogleDriveImportHook');

export interface GoogleDriveImportOptions {
  targetFolderId?: string;
  overwrite?: boolean;
}

/**
 * Hook pour importer les fichiers Google Drive vers le disque local
 */
export const useGoogleDriveImport = () => {
  const { user } = useCurrentUser();
  const company = useRouterCompany();
  const { refresh } = useDriveActions();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
  } | null>(null);

  // Fonction pour créer un dossier
  const createFolder = useCallback(async (name: string, parentId: string) => {
    return await DriveApiClient.create(company, {
      item: {
        company_id: company,
        workspace_id: 'drive',
        parent_id: parentId,
        name: name,
        is_directory: true
      }
    });
  }, [company]);



  /**
   * Importe un dossier Google Drive vers Twake Drive
   * Reproduit exactement la logique Dropbox avec 2 phases
   */
  const importGoogleDriveFolder = useCallback(async (
    googleDrivePath: string = '',
    targetFolderId: string
  ): Promise<void> => {
    if (importing) {
      logger.warn('Import déjà en cours, ignoré');
      return;
    }

    if (!user?.email) {
      throw new Error('Utilisateur non connecté');
    }

    logger.info(`🚀 Starting 2-phase Google Drive sync from ${googleDrivePath} to ${targetFolderId}`);
    setImporting(true);

    try {
      // Phase 1: Analyser l'arborescence Google Drive et retourner les dossiers à créer (comme Dropbox)
      const analyzeResult = await Api.post('/rclone/analyze', {
        path: googleDrivePath,
        userEmail: user.email,
        driveParentId: targetFolderId,
        provider: 'googledrive'
      }) as { success: boolean; folders: string[]; totalFiles: number; diagnostic?: any };
      
      if (!analyzeResult.success) {
        throw new Error('Failed to analyze Google Drive structure');
      }
      
      const foldersToCreate = analyzeResult.folders;
      const totalFiles = analyzeResult.totalFiles;
      
      logger.info(`📁 Found ${foldersToCreate.length} folders to create and ${totalFiles} files to sync`);
      
      // Diagnostic comme Dropbox
      if (analyzeResult.diagnostic) {
        console.log('\n📊 === DIAGNOSTIC GOOGLE DRIVE vs MyDrive (AVANT SYNC) ===');
        console.log('\n📁 GOOGLE DRIVE FOLDERS:');
        analyzeResult.diagnostic.googledrive?.folders?.forEach((folder: any) => {
          console.log(`  📁 ${folder.name} - ${folder.sizeKB} KB`);
        });
        console.log('\n📄 GOOGLE DRIVE FILES (racine uniquement):');
        analyzeResult.diagnostic.googledrive?.files?.forEach((file: any) => {
          console.log(`  📄 ${file.name} - ${file.sizeKB} KB`);
        });
        console.log('\n🗂️ MYDRIVE FOLDERS:');
        analyzeResult.diagnostic.myDrive?.folders?.forEach((folder: any) => {
          console.log(`  📁 ${folder.name} - ${folder.sizeKB} KB`);
        });
        console.log('\n📄 MYDRIVE FILES (racine uniquement):');
        analyzeResult.diagnostic.myDrive?.files?.forEach((file: any) => {
          console.log(`  📄 ${file.name} - ${file.sizeKB} KB`);
        });
        
        const toSyncFolders = analyzeResult.diagnostic.toSync?.folders?.length || 0;
        const toSyncFiles = analyzeResult.diagnostic.toSync?.files?.length || 0;
        const totalGDFolders = analyzeResult.diagnostic.googledrive?.folders?.length || 0;
        const totalGDFiles = analyzeResult.diagnostic.googledrive?.files?.length || 0;
        const totalMDFolders = analyzeResult.diagnostic.myDrive?.folders?.length || 0;
        const totalMDFiles = analyzeResult.diagnostic.myDrive?.files?.length || 0;
        
        console.log('\n📊 SUMMARY:');
        console.log(`  Google Drive: ${totalGDFiles} files, ${totalGDFolders} folders`);
        console.log(`  MyDrive: ${totalMDFiles} files, ${totalMDFolders} folders`);
        console.log('\n🔄 ÉLÉMENTS À SYNCHRONISER:');
        console.log(`  📁 Dossiers: ${toSyncFolders}/${totalGDFolders}`);
        console.log(`  📄 Fichiers: ${toSyncFiles}/${totalGDFiles}`);
        
        if (toSyncFolders === 0 && toSyncFiles === 0) {
          console.log('  ℹ️ Aucun élément à synchroniser (tout est à jour)');
        }
        console.log('\n=== FIN DIAGNOSTIC (AVANT SYNC) ===\n');
        
        // Si rien à synchroniser, arrêter ici comme Dropbox
        if (toSyncFolders === 0 && toSyncFiles === 0) {
          logger.info('ℹ️ Aucun élément à synchroniser - arrêt du processus');
          ToasterService.info('ℹ️ Tous les fichiers Google Drive sont déjà synchronisés !');
          return;
        }
      }
      
      // Phase 2: Créer les dossiers nécessaires
      const folderMap: Record<string, string> = {};
      
      for (const folderPath of foldersToCreate) {
        const folderName = folderPath.split('/').pop() || folderPath;
        const parentPath = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : '';
        const parentId = parentPath ? folderMap[parentPath] : targetFolderId;
        
        if (!parentId) {
          logger.error(`❌ Parent folder not found for: ${folderPath}`);
          continue;
        }
        
        try {
          const createdFolder = await createFolder(folderName, parentId);
          folderMap[folderPath] = createdFolder.id;
          logger.debug(`✅ Created folder: ${folderName} -> ${createdFolder.id}`);
        } catch (error) {
          logger.error(`❌ Failed to create folder ${folderName}:`, error);
          throw error;
        }
      }
      
      // Phase 3: Synchroniser avec la map des dossiers créés
      const syncResult = await Api.post('/rclone/sync', {
        path: googleDrivePath,
        driveParentId: targetFolderId,
        userEmail: user.email,
        folderMap,
        provider: 'googledrive'
      }) as { success: boolean; message: string; filesProcessed?: number };
      
      logger.info('✅ Google Drive sync completed:', syncResult);
      
      // Rafraîchir l'affichage
      await refresh(targetFolderId);
      
      const totalCreated = foldersToCreate.length;
      const filesProcessed = syncResult.filesProcessed || 0;
      
      ToasterService.success(`✅ Google Drive sync completed! ${totalCreated} folders created, ${filesProcessed} files processed.`);
      logger.info(`✅ Google Drive import completed: ${totalCreated} folders created, ${filesProcessed} files processed`);
      
    } catch (error) {
      logger.error('❌ Google Drive import failed:', error);
      ToasterService.error(`❌ Google Drive import failed: ${(error as Error).message}`);
      throw error;
    } finally {
      setImporting(false);
      setImportProgress({ current: 0, total: 0, currentFile: '' });
    }
  }, [importing, user?.email, createFolder, refresh]);

  return {
    importing,
    importProgress,
    importGoogleDriveFolder
  };
};
