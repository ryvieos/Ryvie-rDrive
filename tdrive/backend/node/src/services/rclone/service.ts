import { TdriveService, logger, ServiceName, Prefix, Consumes } from "../../core/platform/framework";
import WebServerAPI from "../../core/platform/services/webserver/provider";
import { FastifyInstance } from "fastify";
import { RcloneAPI } from "./api";
import { exec, spawn } from 'child_process';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import globalResolver from '../global-resolver';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

const execAsync = promisify(exec);

@ServiceName("rclone")
@Prefix("/api/v1")
export default class RcloneService extends TdriveService<RcloneAPI> implements RcloneAPI {
  version = "1";
  name = "rclone";
  
  // Configuration
  private REMOTE_NAME = '';
  private currentUserEmail = 'default@user.com'; // Email de l'utilisateur actuel
  
  // Génère un nom de remote basé sur l'email
  private getRemoteName(userEmail: string): string {
    const sanitized = userEmail.replace(/[@\.]/g, '_').toLowerCase();
    return `dropbox_${sanitized}`;
  }
  private PROXY = process.env.OAUTH_PROXY || 'https://cloudoauth.files.ryvie.fr';
  private DROPBOX_APPKEY = 'fuv2aur5vtmg0r3'; 
  private DROPBOX_APPSECRET = 'ejsdcf3b51q8hvf';

  constructor() {
    super();
    logger.info("Initializing Rclone service");
  }

  api(): RcloneAPI {
    return this;
  }

  async doInit(): Promise<this> {
    const fastify = this.context.getProvider<WebServerAPI>("webserver").getServer();
    
    fastify.register((instance, _opts, next) => {
      this.registerRoutes(instance);
      next();
    });
    
    logger.info("Initializing Rclone service");
    return this;
  }

  async doStart(): Promise<this> {
    logger.info("Starting Rclone service");
    return this;
  }
  
  /**
   * Calcule approximativement la taille d'un dossier en parcourant ses fichiers
   * Limite la profondeur et le nombre de fichiers pour éviter une surcharge
   * S'arrête et retourne -1 si la taille dépasse 5 Go
   */
  private async approximateFolderSize(folderPath: string, depth: number = 0): Promise<number> {
    // Seuil de 5 Go en octets
    const SIZE_THRESHOLD = 5 * 1024 * 1024 * 1024;
    
    // Limiter la profondeur de récursion pour éviter les performances
    if (depth > 2) {
      return 1024 * 1024 * 10; // Retourner 10MB pour les dossiers profonds
    }
    
    try {
      const remotePath = `${this.REMOTE_NAME}:${folderPath}`;
      const cmd = `rclone lsjson "${remotePath}" --max-depth 1`;
      
      const result = await new Promise<string>((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            logger.warn(`Erreur lors du calcul de la taille du dossier ${folderPath}:`, error);
            reject(error);
            return;
          }
          resolve(stdout);
        });
      });
      
      const files = JSON.parse(result || '[]');
      
      // Limiter le nombre de fichiers pour le calcul
      const MAX_FILES = 20;
      const sampleFiles = files.length > MAX_FILES ? files.slice(0, MAX_FILES) : files;
      
      let totalSize = 0;
      let fileCount = 0;
      
      // Calculer la taille des fichiers et sous-dossiers
      for (const file of sampleFiles) {
        // Vérifier si on a déjà dépassé le seuil de 5 Go
        if (totalSize > SIZE_THRESHOLD) {
          logger.info(`Dossier ${folderPath} dépasse le seuil de 5 Go, arrêt du calcul`); 
          return -1; // Code spécial pour indiquer > 5 Go
        }
        
        if (!file.IsDir) {
          totalSize += file.Size || 0;
          fileCount++;
        } else if (depth < 2) {
          // Récursion limitée pour les sous-dossiers
          const subFolderPath = `${folderPath}${folderPath ? '/' : ''}${file.Name}`;
          const subFolderSize = await this.approximateFolderSize(subFolderPath, depth + 1);
          
          // Si un sous-dossier est déjà trop grand
          if (subFolderSize === -1) {
            return -1;
          }
          
          totalSize += subFolderSize;
        }
      }
      
      // Extrapoler la taille si nous n'avons pas traité tous les fichiers
      if (files.length > MAX_FILES) {
        const averageSize = fileCount > 0 ? totalSize / fileCount : 0;
        totalSize = Math.round(averageSize * files.length);
      }
      
      // Vérification finale du seuil de 5 Go
      if (totalSize > SIZE_THRESHOLD) {
        logger.info(`Dossier ${folderPath} dépasse le seuil de 5 Go après extrapolation`); 
        return -1; // Code spécial pour indiquer > 5 Go
      }
      
      return totalSize;
    } catch (error) {
      logger.error(`Erreur lors du calcul de la taille du dossier ${folderPath}:`, error);
      return 0;
    }
  }
  
  /**
   * Formate la taille d'un fichier en format lisible
   */
  private formatFileSize(size: number): string {
    // Code spécial -1 indique une taille > 5 Go
    if (size === -1) {
      return '> 5 Go';
    }
    
    if (size <= 0) return '0 B';
    
    // Taille supérieure à 100MB mais inférieure à 5GB
    if (size > 1024 * 1024 * 100) {
      return '> 100 MB';
    }
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const formattedSize = parseFloat((size / Math.pow(1024, i)).toFixed(2));
    
    return `${formattedSize} ${units[i]}`;
  }
  
  async getAuthUrl(request?: any): Promise<string> {
    const redirectUri = encodeURIComponent(this.PROXY);
    
    // Générer l'URL de callback dynamiquement pour pointer vers le backend
    // mais en utilisant l'adresse accessible depuis l'extérieur
    let callbackBase = '/v1/recover/Dropbox';
    if (request) {
      const protocol = request.protocol || 'http';
      let host = request.headers.host || 'localhost:4000';
      
      // Si l'host contient le port 4000 (backend), on le remplace par 4000
      // pour s'assurer que le callback pointe vers le backend
      if (host.includes(':3000')) {
        host = host.replace(':3000', ':4000');
      } else if (!host.includes(':')) {
        host = `${host}:4000`;
      }
      
      callbackBase = `${protocol}://${host}/v1/recover/Dropbox`;
    }
    
    const state = encodeURIComponent(callbackBase);
    const scope = encodeURIComponent([
      'files.metadata.write',
      'files.content.write',
      'files.content.read',
      'sharing.write',
      'account_info.read'
    ].join(' '));

    const authUrl = [
      'https://www.dropbox.com/1/oauth2/authorize',
      `client_id=${this.DROPBOX_APPKEY}`,
      `redirect_uri=${redirectUri}`,
      'response_type=code',
      `scope=${scope}`,
      `state=${state}`,
      'token_access_type=offline'
    ].join('&').replace('authorize&', 'authorize?');

    logger.info('→ AuthUrl generated:', authUrl);
    return authUrl;
  }

  async listFiles(path: string): Promise<any[]> {
    logger.info(`📁 Listing files at path: ${path}`);
    
    return new Promise(async (resolve, reject) => {
      const remotePath = `${this.REMOTE_NAME}:${path}`;
      const cmd = `rclone lsjson "${remotePath}"`;
      
      logger.info('🔧 Executing rclone command:', cmd);
      
      exec(cmd, async (error, stdout, stderr) => {
        if (error) {
          logger.error('❌ rclone command failed:', { error: error.message, stderr });
          reject(error);
          return;
        }

        if (stderr) {
          logger.warn('⚠️ rclone stderr:', stderr);
        }

        logger.info('📂 rclone stdout length:', stdout.length);

        try {
          const files = JSON.parse(stdout || '[]');
          logger.info('✅ Parsed files count:', files.length);
          
          // Transformer les fichiers au format attendu par Twake Drive
          const transformedFiles = await Promise.all(files.map(async (file: any) => {
            let size = file.Size > 0 ? file.Size : 0;
            
            // Calculer approximativement la taille des dossiers
            if (file.IsDir) {
              size = await this.approximateFolderSize(`${path}${path ? '/' : ''}${file.Name}`);
            }
            
            // Formater la taille pour les gros dossiers
            const formattedSize = size > 1024 * 1024 * 100 ? -1 : size; // -1 indiquera > 100MB
            
            return {
              id: file.ID || file.Path,
              name: file.Name,
              path: file.Path,
              size: formattedSize,
              display_size: this.formatFileSize(size),
              is_directory: file.IsDir || false,
              mime_type: file.MimeType || (file.IsDir ? 'inode/directory' : 'application/octet-stream'),
              modified_at: file.ModTime,
              source: 'dropbox'
            };
          }));
          
          resolve(transformedFiles);
        } catch (parseError) {
          logger.error('📁 Failed to parse rclone output:', { parseError, stdout });
          reject(new Error('Failed to parse file list'));
        }
      });
    });
  }

  /**
   * Synchronisation Dropbox vers Twake Drive avec map des dossiers préalablement créés
   * Phase 2 de la synchronisation en 2 temps
   */
  private async syncDropboxWithFolderMap(
    dropboxPath: string,
    driveParentId: string,
    userEmail: string,
    executionContext: any,
    folderMap: Record<string, string>, // Map: chemin dossier -> ID dossier Twake
    filesToSync?: any[] // Liste optionnelle de fichiers filtrés à synchroniser
  ): Promise<{ success: boolean; message: string; filesProcessed: number }> {
    
    // Mettre à jour le remote pour cet utilisateur
    this.currentUserEmail = userEmail;
    this.REMOTE_NAME = this.getRemoteName(userEmail);
    logger.info(`🔧 Using remote: ${this.REMOTE_NAME}`);
    
    try {
      // 1. Lister tous les fichiers Dropbox récursivement
      let files: any[];
      
      if (filesToSync && filesToSync.length > 0) {
        // Utiliser les fichiers filtrés passés en paramètre
        logger.info(`📋 Using filtered files list: ${filesToSync.length} files`);
        files = filesToSync.map((f: any) => ({
          Path: f.path || f.name, // Utiliser le path ou le nom
          Name: f.name,
          Size: f.sizeKB * 1024 // Convertir KB en bytes
        }));
      } else {
        // Lister tous les fichiers Dropbox récursivement (comportement par défaut)
        const remotePath = `${this.REMOTE_NAME}:${dropboxPath}`;
        const listCommand = `rclone lsjson --recursive "${remotePath}"`;
        logger.info(`📋 Listing all files: ${listCommand}`);
        
        const { stdout } = await execAsync(listCommand);
        const allItems = JSON.parse(stdout);
        files = allItems.filter((f: any) => !f.IsDir);
      }
      
      logger.info(`📊 Found ${files.length} files to sync`);
      
      let processedCount = 0;
      let errorCount = 0;
      
      // 2. Traiter les fichiers par batch
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(async (file: any) => {
            const filePath = dropboxPath ? `${dropboxPath}/${file.Path}` : file.Path;
            
            // Déterminer le dossier parent correct
            const fileDir = file.Path.includes('/') ? file.Path.substring(0, file.Path.lastIndexOf('/')) : '';
            const targetParentId = fileDir && folderMap[fileDir] ? folderMap[fileDir] : driveParentId;
            
            logger.debug(`📁 File ${file.Path} -> Parent: ${targetParentId} (dir: ${fileDir})`);
            
            return await this.syncSingleFileByStreamSimple(filePath, file.Path, targetParentId, executionContext);
          })
        );
        
        // Compter les résultats
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            processedCount++;
            logger.debug(`✅ Synced: ${batch[index].Path}`);
          } else {
            errorCount++;
            logger.error(`❌ Failed to sync ${batch[index].Path}:`, result.reason);
          }
        });
        
        // Petit délai entre les batchs pour éviter la surcharge
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      const message = `Sync completed: ${processedCount} files processed, ${errorCount} errors`;
      logger.info(`✅ ${message}`);
      
      return {
        success: errorCount === 0,
        message,
        filesProcessed: processedCount
      };
      
    } catch (error) {
      logger.error('❌ Sync failed:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
        filesProcessed: 0
      };
    }
  }

  /**
   * Version simplifiée du streaming de fichier sans création de dossiers
   * Utilisée quand les dossiers sont déjà créés par le frontend
   */
  private async syncSingleFileByStreamSimple(
    dropboxFilePath: string,
    fileName: string,
    driveParentId: string,
    executionContext: any
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const remotePath = `${this.REMOTE_NAME}:${dropboxFilePath}`;
      logger.debug(`🔄 Streaming ${fileName} from ${remotePath}`);
      
      const rcloneProcess = spawn('rclone', ['cat', remotePath]);
      const chunks: Buffer[] = [];
      let totalSize = 0;
      
      rcloneProcess.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });
      
      rcloneProcess.stderr.on('data', (data: Buffer) => {
        logger.error(`❌ rclone stderr for ${fileName}:`, data.toString());
      });
      
      rcloneProcess.on('close', async (code: number) => {
        if (code !== 0) {
          reject(new Error(`rclone cat failed with code ${code} for ${fileName}`));
          return;
        }
        
        try {
          // Combiner tous les chunks en un seul buffer
          const fileBuffer = Buffer.concat(chunks);
          
          // Déterminer le type MIME
          const mimeType = this.getMimeType(fileName);
          
          // Extraire le nom du fichier sans le chemin
          const actualFileName = dropboxFilePath.split('/').pop() || fileName;
          
          // Sauvegarder vers Twake Drive directement dans le dossier parent spécifié
          await this.saveStreamToTwakeDrive(fileBuffer, actualFileName, mimeType, driveParentId, executionContext);
          
          logger.debug(`✅ Streamed ${fileName} (${totalSize} bytes) to Twake Drive`);
          resolve();
          
        } catch (error) {
          logger.error(`❌ Failed to save ${fileName} to Twake Drive:`, error);
          reject(error);
        }
      });
      
      rcloneProcess.on('error', (error) => {
        logger.error(`❌ rclone process error for ${fileName}:`, error);
        reject(error);
      });
    });
  }

  /**
   * Synchronisation Dropbox vers Twake Drive avec streaming direct
   * Utilise rclone lsjson + rclone cat pour un streaming efficace
   */
  private async syncDropboxIncremental(
    dropboxPath: string,
    driveParentId: string,
    userEmail: string,
    executionContext: any
  ): Promise<{ success: boolean; message: string; filesProcessed: number }> {
    
    // Mettre à jour le remote pour cet utilisateur
    this.currentUserEmail = userEmail;
    this.REMOTE_NAME = this.getRemoteName(userEmail);
    logger.info(`🔧 Using remote: ${this.REMOTE_NAME}`);
    
    try {
      // 1. Lister tous les fichiers Dropbox récursivement
      const remotePath = `${this.REMOTE_NAME}:${dropboxPath}`;
      const listCommand = `rclone lsjson --recursive "${remotePath}"`;
      
      logger.info(`📋 Listing files: ${listCommand}`);
      const { stdout } = await execAsync(listCommand, { maxBuffer: 10 * 1024 * 1024 });
      
      const files = JSON.parse(stdout).filter((item: any) => !item.IsDir);
      logger.info(`📊 Found ${files.length} files to sync`);
      
      let processedCount = 0;
      let errorCount = 0;
      
      // 2. Traiter les fichiers par lots pour éviter la surcharge
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(async (file: any) => {
            const filePath = dropboxPath ? `${dropboxPath}/${file.Path}` : file.Path;
            return await this.syncSingleFileByStream(filePath, file.Path, driveParentId, executionContext);
          })
        );
        
        // Compter les résultats
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            processedCount++;
            logger.debug(`✅ Synced: ${batch[index].Path}`);
          } else {
            errorCount++;
            logger.error(`❌ Failed to sync ${batch[index].Path}:`, result.reason);
          }
        });
        
        // Petite pause entre les lots
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      const message = `Synchronisation completed. ${processedCount} files synced successfully${errorCount > 0 ? `, ${errorCount} errors` : ''}.`;
      logger.info(`✅ ${message}`);
      
      return {
        success: true,
        message,
        filesProcessed: processedCount
      };
      
    } catch (error) {
      logger.error('❌ Sync failed:', error);
      throw new Error(`Synchronisation failed: ${error.message}`);
    }
  }

  /**
   * Synchronise un seul fichier par streaming direct avec rclone cat
   */
  private async syncSingleFileByStream(
    dropboxFilePath: string,
    fileName: string,
    driveParentId: string,
    executionContext: any
  ): Promise<void> {
    
    const remotePath = `${this.REMOTE_NAME}:${dropboxFilePath}`;
    
    return new Promise((resolve, reject) => {
      // Créer un stream avec rclone cat
      const rcloneProcess = spawn('rclone', ['cat', remotePath]);
      
      const chunks: Buffer[] = [];
      let totalSize = 0;
      
      rcloneProcess.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });
      
      rcloneProcess.stderr.on('data', (data: Buffer) => {
        logger.error(`❌ rclone cat stderr for ${fileName}:`, data.toString());
      });
      
      rcloneProcess.on('close', async (code: number) => {
        if (code !== 0) {
          reject(new Error(`rclone cat failed with code ${code} for ${fileName}`));
          return;
        }
        
        try {
          // Combiner tous les chunks en un seul buffer
          const fileBuffer = Buffer.concat(chunks);
          
          // Déterminer le type MIME
          const mimeType = this.getMimeType(fileName);
          
          // Créer les dossiers nécessaires si le fichier a un chemin avec des sous-dossiers
          const actualParentId = await this.ensureFoldersExist(dropboxFilePath, driveParentId, executionContext);
          
          // Extraire le nom du fichier sans le chemin
          const actualFileName = dropboxFilePath.split('/').pop() || fileName;
          
          // Sauvegarder vers Twake Drive dans le bon dossier parent
          await this.saveStreamToTwakeDrive(fileBuffer, actualFileName, mimeType, actualParentId, executionContext);
          
          logger.debug(`✅ Streamed ${fileName} (${totalSize} bytes) to Twake Drive`);
          resolve();
          
        } catch (error) {
          logger.error(`❌ Failed to save ${fileName} to Twake Drive:`, error);
          reject(error);
        }
      });
      
      rcloneProcess.on('error', (error: Error) => {
        logger.error(`❌ rclone cat process error for ${fileName}:`, error);
        reject(error);
      });
    });
  }



  /**
   * Compte le nombre de fichiers dans un dossier récursivement
   */
  private async countFilesInDirectory(dir: string): Promise<number> {
    let count = 0;
    
    const scan = (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      
      const items = fs.readdirSync(currentDir);
      
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          scan(fullPath); // Récursion
        } else {
          count++;
        }
      }
    };
    
    scan(dir);
    return count;
  }

  /**
   * Détermine le type MIME d'un fichier basé sur son extension
   */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    
    const mimeTypes: { [key: string]: string } = {
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.zip': 'application/zip',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Crée tous les dossiers nécessaires dans Twake Drive basé sur la structure du dossier temporaire
   */
  private async createFoldersFromTempDir(
    tempDir: string,
    driveParentId: string
  ): Promise<Map<string, string>> {
    
    const folderMap = new Map<string, string>();
    folderMap.set('', driveParentId); // Racine
    
    // Pour simplifier, on va créer les dossiers à la volée lors de l'upload des fichiers
    // Cela évite la complexité de parcourir tous les dossiers à l'avance
    
    return folderMap;
  }

  /**
   * Upload un seul fichier depuis le dossier temporaire vers Twake Drive
   */
  private async uploadSingleFileFromTemp(
    filePath: string,
    tempDir: string,
    folderMap: Map<string, string>,
    driveParentId: string,
    executionContext: any
  ): Promise<'new' | 'updated' | 'skipped'> {
    
    // Calculer le chemin relatif
    const relativePath = path.relative(tempDir, filePath);
    const fileName = path.basename(filePath);
    const dirPath = path.dirname(relativePath);
    
    logger.debug(`📄 Processing file: ${relativePath}`);
    
    // Déterminer le dossier parent dans Drive
    let parentId = driveParentId;
    if (dirPath !== '.') {
      parentId = await this.ensureFolderExists(dirPath, folderMap, driveParentId);
    }
    
    // Lire le fichier
    const fileBuffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    
    // Déterminer le type MIME
    const mimeType = this.getMimeType(fileName);
    
    // Pour simplifier, on va toujours uploader le fichier
    // La détection de doublons sera gérée par rclone sync lui-même
    try {
      await this.saveStreamToTwakeDrive(fileBuffer, fileName, mimeType, parentId, executionContext);
      logger.debug(`✅ Uploaded: ${relativePath}`);
      return 'new';
    } catch (error) {
      logger.error(`❌ Failed to upload ${relativePath}:`, error);
      throw error;
    }
  }

  /**
   * S'assure qu'un dossier existe dans Drive et retourne son ID
   */
  private async ensureFolderExists(
    folderPath: string,
    folderMap: Map<string, string>,
    rootParentId: string
  ): Promise<string> {
    
    if (folderMap.has(folderPath)) {
      return folderMap.get(folderPath)!;
    }
    
    // Créer le dossier via l'API interne (simplifié)
    // Pour l'instant, on va retourner le rootParentId
    // TODO: Implémenter la création de dossiers via l'API interne
    
    folderMap.set(folderPath, rootParentId);
    return rootParentId;
  }

  /**
   * Crée automatiquement les dossiers nécessaires pour un chemin de fichier Dropbox
   * Ex: "logo/subfolder/photo.png" créera les dossiers "logo" puis "logo/subfolder"
   */
  private async ensureFoldersExist(
    dropboxFilePath: string,
    rootParentId: string,
    executionContext: any
  ): Promise<string> {
    
    // Extraire le chemin du dossier (sans le nom du fichier)
    const pathParts = dropboxFilePath.split('/');
    const fileName = pathParts.pop(); // Enlever le nom du fichier
    
    // Si pas de dossiers à créer, retourner le parent racine
    if (pathParts.length === 0) {
      return rootParentId;
    }
    
    let currentParentId = rootParentId;
    
    // Créer chaque dossier dans l'ordre hiérarchique
    for (const folderName of pathParts) {
      try {
        logger.debug(`📁 Creating folder: ${folderName} in parent ${currentParentId}`);
        
        // Créer un contexte spécifique pour la création de dossiers
        const folderContext = {
          ...executionContext,
          user: {
            ...executionContext.user,
            application_id: null // Requis pour la création de dossiers
          }
        };
        
        // Pour créer un dossier, il faut utiliser la même signature que pour les fichiers
        // mais avec des données spécifiques aux dossiers
        const folderData = {
          parent_id: currentParentId,
          name: folderName,
          is_directory: true
        };
        
        // Pas de version data pour les dossiers
        const versionData = null;
        
        const createdFolder = await globalResolver.services.documents.documents.create(
          null, // Pas de fichier physique pour un dossier
          folderData,
          versionData,
          folderContext
        );
        
        currentParentId = createdFolder.id;
        logger.debug(`✅ Folder created: ${folderName} with ID ${currentParentId}`);
        
      } catch (error) {
        // Si le dossier existe déjà, essayer de le récupérer
        logger.debug(`⚠️ Folder ${folderName} might already exist, trying to find it...`);
        
        try {
          // Rechercher le dossier existant via browse
          const folderContext = {
            ...executionContext,
            user: {
              ...executionContext.user,
              application_id: null // Requis pour browse
            }
          };
          
          const browseResult = await globalResolver.services.documents.documents.browse(
            currentParentId,
            {},
            folderContext
          );
          
          // Chercher le dossier par nom dans les résultats
          const existingFolder = browseResult.children?.find(
            (item: any) => item.name === folderName && item.is_directory
          );
          
          if (existingFolder) {
            currentParentId = existingFolder.id;
            logger.debug(`✅ Found existing folder: ${folderName} with ID ${currentParentId}`);
          } else {
            logger.error(`❌ Could not create or find folder: ${folderName}`);
            throw new Error(`Failed to create or find folder: ${folderName}`);
          }
        } catch (findError) {
          logger.error(`❌ Error finding existing folder ${folderName}:`, findError);
          throw findError;
        }
      }
    }
    
    return currentParentId;
  }

  /**
   * Save a file buffer to Twake Drive using internal services
   */
  private async saveStreamToTwakeDrive(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    driveParentId: string,
    executionContext: any
  ): Promise<void> {
    try {
      // Create a readable stream from the buffer
      const { Readable } = require('stream');
      const fileStream = new Readable({
        read() {
          this.push(fileBuffer);
          this.push(null); // End of stream
        }
      });

      // Create execution context for Twake Drive operations
      // For server-side operations, we need to create a proper context
      const context = executionContext;
      
      // Upload options for the file
      const uploadOptions = {
        totalChunks: 1,
        totalSize: fileBuffer.length,
        chunkNumber: 1,
        filename: fileName,
        type: mimeType,
        waitForThumbnail: false,
        ignoreThumbnails: false,
      };

      // Save the file using Twake Drive's file service
      const savedFile = await globalResolver.services.files.save(
        null, // No existing file ID
        fileStream,
        uploadOptions,
        context,
      );

      logger.info(`📁 File saved to storage: ${savedFile.id} (${fileName})`);

      // Create drive item metadata
      const driveItemData = {
        parent_id: driveParentId,
        name: fileName,
        is_directory: false,
        extension: fileName.split('.').pop() || '',
        size: fileBuffer.length,
      };

      // Create file version metadata
      const versionData = {
        filename: fileName,
        file_size: fileBuffer.length,
        file_metadata: {
          source: 'internal',
          external_id: savedFile.id,
          name: fileName,
          mime: mimeType,
          size: fileBuffer.length,
          thumbnails: savedFile.thumbnails || [],
        },
      };

      // Create the drive item using the documents service
      const driveItem = await globalResolver.services.documents.documents.create(
        savedFile,
        driveItemData,
        versionData,
        context,
      );

      logger.info(`✅ Drive item created: ${driveItem.id} (${fileName}) in folder ${driveParentId}`);
      
    } catch (error) {
      logger.error(`❌ Failed to save ${fileName} to Twake Drive:`, error);
      throw error;
    }
  }

  private registerRoutes(fastify: FastifyInstance) {
    // Register routes
    const apiPrefix = "/api/v1";
    
    // 1) Generate AuthUrl for Dropbox OAuth
    // Le frontend appelle /v1/drivers/Dropbox (sans le préfixe api)
    // ... (le reste du code reste inchangé)
    fastify.get(`/v1/drivers/Dropbox`, async (request: any, reply) => {
      // Récupérer l'email utilisateur depuis les query parameters
      const userEmail = request.query.userEmail as string || 'default@user.com';
      logger.info('📧 Email utilisateur reçu:', userEmail);
      
      // Mettre à jour le remote pour cet utilisateur
      this.currentUserEmail = userEmail;
      this.REMOTE_NAME = this.getRemoteName(userEmail);
      logger.info('🔧 Remote name mis à jour:', this.REMOTE_NAME);
      
      const authUrl = await this.getAuthUrl(request);
      logger.info('→ AuthUrl generated:', authUrl);
      // Important: Format exact attendu par le frontend
      // Pas de .type() pour laisser Fastify définir correctement l'en-tête Content-Type
      return reply.send({ addition: { AuthUrl: authUrl } });

    });
    
    // 2) OAuth callback
    // Le frontend s'attend à recevoir une redirection vers cette route
    fastify.get(`/v1/recover/Dropbox`, async (request: any, reply) => {
      const fullUrl = `${request.protocol}://${request.hostname}${request.url}`;
      logger.info('🔔 Callback received:', fullUrl);

      const code = request.query.code as string | undefined;
      if (!code) {
        return reply.status(400).send('❌ Missing code');
      }

      const params = new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        client_id: this.DROPBOX_APPKEY,
        client_secret: this.DROPBOX_APPSECRET,
        redirect_uri: this.PROXY
      });

      try {
        const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });
        
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok) {
          logger.error('Token error:', tokenJson);
          return reply.status(500).send('Token exchange failed');
        }

        // Create rclone remote avec nom fixe pour utilisation depuis l'hôte
        const remoteName = this.REMOTE_NAME; // Utilise 'test4'
        
        const tokenForRclone = JSON.stringify({
          access_token: tokenJson.access_token,
          refresh_token: tokenJson.refresh_token,
          expiry: tokenJson.expires_at
        });
        
        // D'abord, supprimer le remote s'il existe déjà, puis le créer
        // Spécifier explicitement le chemin de configuration
        const configPath = '/root/.config/rclone/rclone.conf';
        const deleteCmd = `rclone --config ${configPath} config delete ${remoteName} 2>/dev/null || true`;
        const createCmd = `rclone --config ${configPath} config create ${remoteName} dropbox token '${tokenForRclone}' --non-interactive`;
        
        exec(`${deleteCmd} && ${createCmd}`, (err, stdout, stderr) => {
          if (err) {
            logger.error('rclone config failed:', { error: err.message, stderr, stdout });
          } else {
            logger.info(`✅ Remote "${remoteName}" created in rclone.conf`);
            logger.info('rclone stdout:', stdout);
          }
        });

        return reply.send('✅ Authentication successful! You may close this window.');
      } catch (error) {
        logger.error('Exchange error:', error);
        return reply.status(500).send('Internal OAuth error');
      }
    });
    
    // 3) List files - cette route peut garder le préfixe api car elle est appelée par le backend
    fastify.get(`${apiPrefix}/files/rclone/list`, {
      preValidation: fastify.authenticate
    }, async (request: any, reply) => {
      //logger.info('📋 List files endpoint called with path:', request.query.path);
      try {
        const path = (request.query.path as string) || '';
        const userEmail = request.query.userEmail as string || 'default@user.com';
        
        logger.info('📧 Email utilisateur pour listing:', userEmail);
        
        // Mettre à jour le remote name pour cet utilisateur
        this.currentUserEmail = userEmail;
        this.REMOTE_NAME = this.getRemoteName(userEmail);
       // logger.info('🔧 Remote name mis à jour pour listing:', this.REMOTE_NAME);
        
       // logger.info('🚀 About to call listFiles with path:', path);
        const files = await this.listFiles(path);
       // logger.info('📤 Sending files response:', files.length, 'files');
        return reply.send(files);
      } catch (error) {
       // logger.error('❌ Listing exception:', error);
        return reply.status(500).send({ error: 'Internal listing error', message: error.message });
      }
    });
    
    // 4) Download file - endpoint pour télécharger un fichier Dropbox
    fastify.get(`${apiPrefix}/files/rclone/download`, {
      preValidation: fastify.authenticate
    }, async (request: any, reply) => {
      logger.info('📥 Download file endpoint called');
      logger.info('📥 Request query:', JSON.stringify(request.query));
      logger.info('📥 Request params:', JSON.stringify(request.params));
      try {
        const path = (request.query.path as string) || '';
        const userEmail = request.query.userEmail as string || 'default@user.com';
        
        logger.info('📥 Paramètres extraits - path: "' + path + '", userEmail: "' + userEmail + '"');
        
        if (!path) {
          return reply.status(400).send({ error: 'Path parameter is required' });
        }
        
        // Mettre à jour le remote name pour cet utilisateur
        this.currentUserEmail = userEmail;
        this.REMOTE_NAME = this.getRemoteName(userEmail);
        logger.info('🔧 Remote name calculé: "' + this.REMOTE_NAME + '"');
        
        const remotePath = `${this.REMOTE_NAME}:${path}`;
        logger.info('📂 Chemin remote complet: "' + remotePath + '"');
        
        // Utiliser rclone cat pour obtenir le contenu du fichier
        const cmd = `rclone cat "${remotePath}"`;
        logger.info('🔧 Commande rclone à exécuter: "' + cmd + '"');
        
        const { exec } = require('child_process');
        
        return new Promise((resolve, reject) => {
          const child = exec(cmd, { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
              logger.error('❌ rclone download command failed:');
              logger.error('❌ Error message: "' + error.message + '"');
              logger.error('❌ Error code: "' + error.code + '"');
              logger.error('❌ Stderrrrrrrrrrrrrrrrrrrr: "' + (stderr?.toString() || 'N/A') + '"');
              logger.error('❌ Command was: "' + cmd + '"');
              reply.status(500).send({ error: 'Download failed', message: error.message, stderr: stderr?.toString() });
              return reject(error);
            }
            
            if (stderr) {
              logger.warn('⚠️ rclone download stderr:', stderr);
            }
            
            logger.info('📤 File downloaded successfully, size:', stdout.length, 'bytes');
            
            // Déterminer le type MIME basé sur l'extension
            const fileName = path.split('/').pop() || 'file';
            const extension = fileName.split('.').pop()?.toLowerCase();
            let contentType = 'application/octet-stream';
            
            switch (extension) {
              case 'png': contentType = 'image/png'; break;
              case 'jpg': case 'jpeg': contentType = 'image/jpeg'; break;
              case 'gif': contentType = 'image/gif'; break;
              case 'pdf': contentType = 'application/pdf'; break;
              case 'txt': contentType = 'text/plain'; break;
              case 'doc': contentType = 'application/msword'; break;
              case 'docx': contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; break;
              case 'mp4': contentType = 'video/mp4'; break;
              case 'mp3': contentType = 'audio/mpeg'; break;
              default: contentType = 'application/octet-stream';
            }
            
            logger.info('📤 Content-Type détecté:', contentType, 'pour le fichier:', fileName);
            
            // Définir les en-têtes appropriés
            reply.header('Content-Type', contentType);
            reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
            
            reply.send(stdout);
            resolve(stdout);
          });
        });
        
      } catch (error) {
        logger.error('❌ Download exception:', error);
        return reply.status(500).send({ error: 'Internal download error', message: error.message });
      }
    });

    // 5) Synchronisation incrémentale avec rclone sync
    // Phase 1: Analyser l'arborescence Dropbox et retourner les dossiers à créer
    fastify.post(`${apiPrefix}/rclone/analyze`, {
      preValidation: fastify.authenticate
    }, async (request: any, reply) => {
      logger.info('🔍 ANALYZE ENDPOINT CALLED');
      try {
        const { path: dropboxPath = '', userEmail } = request.body;
        
        if (!userEmail) {
          return reply.status(400).send({ error: 'userEmail is required' });
        }
        
        logger.info(`🔍 Analyzing Dropbox structure for user: ${userEmail}`);
        logger.info(`📂 Dropbox path: "${dropboxPath}"`);
        
        // Mettre à jour le remote pour cet utilisateur
        this.currentUserEmail = userEmail;
        this.REMOTE_NAME = this.getRemoteName(userEmail);
        
        // Lister tous les fichiers Dropbox
        const remotePath = `${this.REMOTE_NAME}:${dropboxPath}`;
        const listCommand = `rclone lsjson --recursive "${remotePath}"`;
        logger.info(`📋 Listing files: ${listCommand}`);
        
        const { stdout } = await execAsync(listCommand);
        const files = JSON.parse(stdout).filter((f: any) => !f.IsDir);
        
        // Extraire tous les dossiers nécessaires
        const foldersToCreate = new Set<string>();
        files.forEach((file: any) => {
          const pathParts = file.Path.split('/');
          pathParts.pop(); // Enlever le nom du fichier
          
          // Ajouter chaque niveau de dossier
          let currentPath = '';
          pathParts.forEach(part => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (currentPath) {
              foldersToCreate.add(currentPath);
            }
          });
        });
        
        const foldersArray = Array.from(foldersToCreate).sort();
        
        logger.info(`📁 Found ${foldersArray.length} folders to create:`, foldersArray);
        
        // === DIAGNOSTIC COMPLET (avant synchronisation) ===
        let diagnosticData = null;
        try {
          logger.info('\n🚀 === DIAGNOSTIC: LISTING CONTENT FOR COMPARISON ===');
          
          // 1. LISTER DROPBOX CONTENT
          const allDropboxItems = JSON.parse(stdout);
          const dropboxFolders = allDropboxItems.filter((f: any) => f.IsDir);
          const dropboxAllFiles = allDropboxItems.filter((f: any) => !f.IsDir);
          
          // Filtrer pour ne garder que les fichiers à la racine (pas dans des sous-dossiers)
          const dropboxRootFiles = dropboxAllFiles.filter((f: any) => !f.Path.includes('/'));
          
          // Calculer la taille des dossiers
          const foldersWithSize = dropboxFolders.map((folder: any) => {
            const folderFiles = dropboxAllFiles.filter((f: any) => f.Path.startsWith(folder.Path + '/'));
            const totalSize = folderFiles.reduce((sum: number, f: any) => sum + f.Size, 0);
            return {
              name: folder.Name,
              path: folder.Path,
              sizeKB: Math.round(totalSize / 1024)
            };
          });
          
          logger.info(`📁 DROPBOX FOLDERS (${foldersWithSize.length}):`);
          foldersWithSize.forEach((folder: any) => {
            logger.info(`  📁 ${folder.name} - ${folder.sizeKB} KB`);
          });
          
          logger.info(`📄 DROPBOX FILES (racine uniquement) (${dropboxRootFiles.length}):`);
          dropboxRootFiles.forEach((file: any) => {
            const sizeKB = Math.round(file.Size / 1024);
            logger.info(`  📄 ${file.Path} (${file.Name}) - ${sizeKB} KB`);
          });
          
          // 2. LISTER MYDRIVE CONTENT (si driveParentId fourni)
          const driveParentId = request.body.driveParentId;
          if (driveParentId) {
            logger.info('\n🗂️ === MYDRIVE CONTENT ===');
            
            const executionContext = {
              company: { id: 'af114530-5cc6-11f0-8de8-f78b546249a5' },
              user: { 
                id: request.user?.id || '4e272180-5cc7-11f0-917c-559ae224df7f',
                email: userEmail,
                server_request: true,
                application_id: null
              }
            };
            
            const browseResult = await globalResolver.services.documents.documents.browse(
              driveParentId,
              {},
              executionContext
            );
            
            const myDriveFolders = browseResult.children?.filter((item: any) => item.is_directory) || [];
            const myDriveFiles = browseResult.children?.filter((item: any) => !item.is_directory) || [];
            
            // Calculer la taille des dossiers MyDrive (approximation basée sur les fichiers directs)
            const myDriveFoldersWithSize = myDriveFolders.map((folder: any) => ({
              name: folder.name,
              id: folder.id,
              sizeKB: Math.round((folder.size || 0) / 1024) // Taille du dossier si disponible
            }));
            
            const myDriveRootFiles = myDriveFiles.map((file: any) => ({
              name: file.name,
              id: file.id,
              sizeKB: Math.round((file.size || 0) / 1024)
            }));
            
            logger.info(`📁 MYDRIVE FOLDERS (${myDriveFoldersWithSize.length}):`);
            myDriveFoldersWithSize.forEach((folder: any) => {
              logger.info(`  📁 ${folder.name} - ${folder.sizeKB} KB`);
            });
            
            logger.info(`📄 MYDRIVE FILES (racine uniquement) (${myDriveRootFiles.length}):`);
            myDriveRootFiles.forEach((file: any) => {
              logger.info(`  📄 ${file.name} - ${file.sizeKB} KB`);
            });
            
            // === LOGIQUE DE SYNCHRONISATION CONDITIONNELLE ===
            const TOLERANCE_KB = 1; // Tolérance de ±1KB
            
            // Analyser les dossiers à synchroniser
            const foldersToSync = foldersWithSize.filter((dbFolder: any) => {
              const matchingFolder = myDriveFoldersWithSize.find((mdFolder: any) => 
                mdFolder.name === dbFolder.name // Comparaison stricte
              );
              
              if (!matchingFolder) {
                logger.info(`✅ DOSSIER À SYNC: "${dbFolder.name}" (nouveau, ${dbFolder.sizeKB} KB)`);
                return true; // Nouveau dossier
              }
              
              const sizeDiff = Math.abs(dbFolder.sizeKB - matchingFolder.sizeKB);
              if (sizeDiff > TOLERANCE_KB) {
                logger.info(`✅ DOSSIER À SYNC: "${dbFolder.name}" (taille différente: ${dbFolder.sizeKB} KB vs ${matchingFolder.sizeKB} KB)`);
                return true; // Taille différente
              }
              
              logger.info(`❌ DOSSIER IGNORÉ: "${dbFolder.name}" (identique: ${dbFolder.sizeKB} KB)`);
              return false; // Déjà à jour
            });
            
            // Analyser les fichiers à synchroniser
            const dropboxRootFilesFormatted = dropboxRootFiles.map((f: any) => ({
              name: f.Name,
              sizeKB: Math.round(f.Size / 1024)
            }));
            
            const filesToSync = dropboxRootFilesFormatted.filter((dbFile: any) => {
              const matchingFile = myDriveRootFiles.find((mdFile: any) => 
                mdFile.name === dbFile.name // Comparaison stricte
              );
              
              if (!matchingFile) {
                logger.info(`✅ FICHIER À SYNC: "${dbFile.name}" (nouveau, ${dbFile.sizeKB} KB)`);
                return true; // Nouveau fichier
              }
              
              const sizeDiff = Math.abs(dbFile.sizeKB - matchingFile.sizeKB);
              if (sizeDiff > TOLERANCE_KB) {
                logger.info(`✅ FICHIER À SYNC: "${dbFile.name}" (taille différente: ${dbFile.sizeKB} KB vs ${matchingFile.sizeKB} KB)`);
                return true; // Taille différente
              }
              
              logger.info(`❌ FICHIER IGNORÉ: "${dbFile.name}" (identique: ${dbFile.sizeKB} KB)`);
              return false; // Déjà à jour
            });
            
            logger.info(`\n📊 RÉSULTAT ANALYSE: ${foldersToSync.length}/${foldersWithSize.length} dossiers à sync, ${filesToSync.length}/${dropboxRootFilesFormatted.length} fichiers à sync`);
            
            // Préparer les données pour le frontend
            diagnosticData = {
              dropbox: {
                folders: foldersWithSize,
                files: dropboxRootFilesFormatted
              },
              myDrive: {
                folders: myDriveFoldersWithSize,
                files: myDriveRootFiles
              },
              toSync: {
                folders: foldersToSync,
                files: filesToSync
              }
            };
            
            // 3. COMPARAISON
            logger.info('\n🔍 === COMPARISON ANALYSIS ===');
            
            // Comparer les dossiers
            logger.info('📁 FOLDER COMPARISON:');
            dropboxFolders.forEach((dbFolder: any) => {
              const matchingFolder = myDriveFolders.find((mdFolder: any) => {
                const baseName = dbFolder.Name;
                const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`);
                return pattern.test(mdFolder.name);
              });
              
              if (matchingFolder) {
                logger.info(`  ✅ MATCH: Dropbox "${dbFolder.Name}" <-> MyDrive "${matchingFolder.name}"`);
              } else {
                logger.info(`  ❌ MISSING: Dropbox "${dbFolder.Name}" not found in MyDrive`);
              }
            });
            
            // Comparer les fichiers (racine uniquement)
            logger.info('📄 FILE COMPARISON (racine uniquement):');
            dropboxRootFiles.forEach((dbFile: any) => {
              const matchingFile = myDriveFiles.find((mdFile: any) => {
                const baseName = dbFile.Name.split('.')[0];
                const extension = dbFile.Name.includes('.') ? '.' + dbFile.Name.split('.').pop() : '';
                const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
                
                const nameMatch = pattern.test(mdFile.name);
                const sizeMatch = Math.abs((mdFile.size || 0) - dbFile.Size) < 1024; // Tolérance 1KB
                
                return nameMatch && sizeMatch;
              });
              
              const dbSizeKB = Math.round(dbFile.Size / 1024);
              if (matchingFile) {
                const mdSizeKB = Math.round((matchingFile.size || 0) / 1024);
                logger.info(`  ✅ MATCH: Dropbox "${dbFile.Name}" (${dbSizeKB}KB) <-> MyDrive "${matchingFile.name}" (${mdSizeKB}KB)`);
              } else {
                logger.info(`  ❌ MISSING: Dropbox "${dbFile.Name}" (${dbSizeKB}KB) not found in MyDrive`);
              }
            });
          } else {
            logger.info('⚠️ No driveParentId provided, skipping MyDrive comparison');
          }
          
          logger.info('🏁 === DIAGNOSTIC COMPLETE ===\n');
          
        } catch (diagError) {
          logger.error('❌ Diagnostic logging failed:', diagError);
        }
        // === FIN LOGS DE DIAGNOSTIC ===
        
        return reply.send({
          success: true,
          folders: foldersArray,
          totalFiles: files.length,
          diagnostic: diagnosticData // Données de diagnostic pour le frontend
        });
        
      } catch (error) {
        logger.error('❌ Failed to analyze Dropbox structure:', error);
        return reply.status(500).send({ 
          success: false, 
          error: 'Failed to analyze Dropbox structure',
          details: error.message 
        });
      }
    });
    
    // Phase 2: Synchroniser les fichiers avec la map des dossiers créés
    fastify.post(`${apiPrefix}/rclone/sync`, {
      preValidation: fastify.authenticate
    }, async (request: any, reply) => {
      logger.info('🔄 SYNC ENDPOINT CALLED');
      try {
        const { path: dropboxPath = '', userEmail, driveParentId, folderMap = {} } = request.body;
        
        if (!userEmail) {
          return reply.status(400).send({ error: 'userEmail is required' });
        }
        
        if (!driveParentId) {
          return reply.status(400).send({ error: 'driveParentId is required' });
        }
        
        logger.info(`🚀 Starting file sync for user: ${userEmail}`);
        logger.info(`📂 Dropbox path: "${dropboxPath}", Drive parent: "${driveParentId}"`);
        logger.info(`📁 Folder map:`, folderMap);
        
        // Créer le contexte d'exécution
        const executionContext = {
          company: { id: 'af114530-5cc6-11f0-8de8-f78b546249a5' },
          user: { 
            id: request.user?.id || '4e272180-5cc7-11f0-917c-559ae224df7f',
            email: userEmail,
            server_request: true,
            application_id: null
          },
          url: '/api/v1/rclone/sync',
          method: 'POST',
          reqId: 'rclone-sync',
          transport: 'http' as const,
        };
        
        // === LOGIQUE DE SYNCHRONISATION CONDITIONNELLE (comme dans /analyze) ===
        // Mettre à jour le remote pour cet utilisateur
        this.currentUserEmail = userEmail;
        this.REMOTE_NAME = this.getRemoteName(userEmail);
        
        // 1. LISTER DROPBOX CONTENT
        const remotePath = `${this.REMOTE_NAME}:${dropboxPath}`;
        const listCommand = `rclone lsjson --recursive "${remotePath}"`;
        
        const { stdout } = await execAsync(listCommand);
        const allDropboxItems = JSON.parse(stdout);
        const dropboxFolders = allDropboxItems.filter((f: any) => f.IsDir);
        const dropboxAllFiles = allDropboxItems.filter((f: any) => !f.IsDir);
        
        // Filtrer pour ne garder que les fichiers à la racine (pas dans des sous-dossiers)
        const dropboxRootFiles = dropboxAllFiles.filter((f: any) => !f.Path.includes('/'));
        
        // Calculer la taille des dossiers
        const foldersWithSize = dropboxFolders.map((folder: any) => {
          const folderFiles = dropboxAllFiles.filter((f: any) => f.Path.startsWith(folder.Path + '/'));
          const totalSize = folderFiles.reduce((sum: number, f: any) => sum + f.Size, 0);
          return {
            name: folder.Name,
            path: folder.Path,
            sizeKB: Math.round(totalSize / 1024)
          };
        });
        
        // 2. LISTER MYDRIVE CONTENT
        const browseResult = await globalResolver.services.documents.documents.browse(
          driveParentId,
          {},
          executionContext
        );
        
        const myDriveFolders = browseResult.children?.filter((item: any) => item.is_directory) || [];
        const myDriveFiles = browseResult.children?.filter((item: any) => !item.is_directory) || [];
        
        const myDriveFoldersWithSize = myDriveFolders.map((folder: any) => ({
          name: folder.name,
          id: folder.id,
          sizeKB: Math.round((folder.size || 0) / 1024)
        }));
        
        const myDriveRootFiles = myDriveFiles.map((file: any) => ({
          name: file.name,
          id: file.id,
          sizeKB: Math.round((file.size || 0) / 1024)
        }));
        
        // 3. APPLIQUER LA LOGIQUE CONDITIONNELLE
        const TOLERANCE_KB = 1; // Tolérance de ±1KB
        
        // Filtrer les fichiers à synchroniser
        const dropboxRootFilesFormatted = dropboxRootFiles.map((f: any) => ({
          name: f.Name,
          path: f.Path,
          sizeKB: Math.round(f.Size / 1024)
        }));
        
        // Analyser les dossiers à synchroniser
        const foldersToSync = foldersWithSize.filter((dbFolder: any) => {
          const matchingFolder = myDriveFoldersWithSize.find((mdFolder: any) => 
            mdFolder.name === dbFolder.name // Comparaison stricte
          );
          
          if (!matchingFolder) {
            logger.info(`✅ DOSSIER À SYNC: "${dbFolder.name}" (nouveau, ${dbFolder.sizeKB} KB)`);
            return true; // Nouveau dossier
          }
          
          const sizeDiff = Math.abs(dbFolder.sizeKB - matchingFolder.sizeKB);
          if (sizeDiff > TOLERANCE_KB) {
            logger.info(`✅ DOSSIER À SYNC: "${dbFolder.name}" (taille différente: ${dbFolder.sizeKB} KB vs ${matchingFolder.sizeKB} KB)`);
            return true; // Taille différente
          }
          
          logger.info(`❌ DOSSIER IGNORÉ: "${dbFolder.name}" (identique: ${dbFolder.sizeKB} KB)`);
          return false; // Déjà à jour
        });
        
        // Analyser les fichiers racine à synchroniser
        const rootFilesToSync = dropboxRootFilesFormatted.filter((dbFile: any) => {
          const matchingFile = myDriveRootFiles.find((mdFile: any) => 
            mdFile.name === dbFile.name // Comparaison stricte
          );
          
          if (!matchingFile) {
            logger.info(`✅ FICHIER RACINE À SYNC: "${dbFile.name}" (nouveau, ${dbFile.sizeKB} KB)`);
            return true; // Nouveau fichier
          }
          
          const sizeDiff = Math.abs(dbFile.sizeKB - matchingFile.sizeKB);
          if (sizeDiff > TOLERANCE_KB) {
            logger.info(`✅ FICHIER RACINE À SYNC: "${dbFile.name}" (taille différente: ${dbFile.sizeKB} KB vs ${matchingFile.sizeKB} KB)`);
            return true; // Taille différente
          }
          
          logger.info(`❌ FICHIER RACINE IGNORÉ: "${dbFile.name}" (identique: ${dbFile.sizeKB} KB)`);
          return false; // Déjà à jour
        });
        
        // Ajouter tous les fichiers des dossiers à synchroniser
        const folderFilesToSync: any[] = [];
        for (const folder of foldersToSync) {
          const folderFiles = dropboxAllFiles.filter((f: any) => f.Path.startsWith(folder.path + '/'));
          folderFiles.forEach((file: any) => {
            folderFilesToSync.push({
              name: file.Name,
              path: file.Path,
              sizeKB: Math.round(file.Size / 1024)
            });
            logger.info(`✅ FICHIER DOSSIER À SYNC: "${file.Path}" (dans dossier ${folder.name})`);
          });
        }
        
        // Combiner tous les fichiers à synchroniser
        const allFilesToSync = [...rootFilesToSync, ...folderFilesToSync];
        
        logger.info(`\n📊 SYNC CONDITIONNEL: ${allFilesToSync.length} fichiers à synchroniser (${rootFilesToSync.length} racine + ${folderFilesToSync.length} dans dossiers)`);
        
        // Si aucun fichier à synchroniser, retourner directement
        if (allFilesToSync.length === 0) {
          logger.info('ℹ️ Aucun fichier à synchroniser (tout est à jour)');
          return reply.send({
            success: true,
            message: 'Aucun fichier à synchroniser - tout est à jour',
            filesProcessed: 0
          });
        }
        
        // Synchroniser seulement les fichiers filtrés
        const result = await this.syncDropboxWithFolderMap(dropboxPath, driveParentId, userEmail, executionContext, folderMap, allFilesToSync);
        
        logger.info(`✅ Sync completed: ${result.message}`);
        return reply.send({
          success: true,
          message: result.message,
          filesProcessed: result.filesProcessed
        });
        
      } catch (error) {
        logger.error('❌ Sync exception:', error);
        return reply.status(500).send({ 
          error: 'Sync failed', 
          message: error.message 
        });
      }
    });
    

  }
}
