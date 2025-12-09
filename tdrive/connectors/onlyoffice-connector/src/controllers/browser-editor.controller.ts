import editorService from '@/services/editor.service';
import { NextFunction, Request, Response } from 'express';
import { CREDENTIALS_SECRET } from '@config';
import jwt from 'jsonwebtoken';
import driveService from '@/services/drive.service';
import { DriveFileType } from '@/interfaces/drive.interface';
import fileService from '@/services/file.service';
import { OfficeToken } from '@/interfaces/office-token.interface';
import logger from '@/lib/logger';
import { makeURLTo } from '@/routes';
import { networkInterfaces } from 'os';

interface RequestQuery {
  mode: string;
  company_id: string;
  preview: string;
  token: string;
  file_id: string;
  drive_file_id?: string;
}

interface RequestEditorQuery {
  office_token: string;
  company_id: string;
  file_id: string;
  drive_file_id: string;
}

/**
 * Get the private IP address of the machine's primary network interface
 * Prioritizes physical network interfaces (enp, eth, ens) over virtual ones (wt, docker, br)
 */
function getPrivateIPAddress(): string | null {
  const nets = networkInterfaces();
  
  logger.info('🔍 [getPrivateIPAddress] Détection de l\'IP privée - Interfaces disponibles:', Object.keys(nets));
  
  // Interfaces to exclude (Docker, virtual bridges, etc.)
  const excludedPrefixes = ['br-', 'docker', 'veth'];
  
  // First pass: look for physical network interfaces (enp, eth, ens, wlan)
  const physicalInterfaces = ['enp', 'eth', 'ens', 'wlan'];
  for (const name of Object.keys(nets)) {
    // Skip excluded interfaces
    if (excludedPrefixes.some(prefix => name.startsWith(prefix))) {
      continue;
    }
    
    // Check if it's a physical interface
    if (physicalInterfaces.some(prefix => name.startsWith(prefix))) {
      const netInterfaces = nets[name];
      if (!netInterfaces) continue;
      
      for (const net of netInterfaces) {
        if (net.family === 'IPv4' && !net.internal) {
          const addr = net.address;
          // Return any private IP from physical interface
          if (addr.startsWith('10.') || 
              addr.startsWith('192.168.') ||
              (addr.startsWith('172.') && parseInt(addr.split('.')[1]) >= 16 && parseInt(addr.split('.')[1]) <= 31)) {
            logger.info(`Detected primary network interface ${name} with IP ${addr}`);
            return addr;
          }
        }
      }
    }
  }
  
  // Second pass: fallback to any private IP (10.x, 192.168.x, 172.16-31.x) but still exclude Docker and Tailscale
  for (const name of Object.keys(nets)) {
    // Skip excluded interfaces
    if (excludedPrefixes.some(prefix => name.startsWith(prefix))) {
      continue;
    }
    
    const netInterfaces = nets[name];
    if (!netInterfaces) continue;
    
    for (const net of netInterfaces) {
      if (net.family === 'IPv4' && !net.internal) {
        const addr = net.address;
        // Exclude Tailscale (100.x) from fallback - prioritize physical network IPs
        if (addr.startsWith('10.') || 
            addr.startsWith('192.168.') ||
            (addr.startsWith('172.') && parseInt(addr.split('.')[1]) >= 16 && parseInt(addr.split('.')[1]) <= 31)) {
          logger.info(`Detected fallback network interface ${name} with IP ${addr}`);
          return addr;
        }
      }
    }
  }
  
  // Third pass: if no physical private IP found, use Tailscale as last resort
  for (const name of Object.keys(nets)) {
    if (excludedPrefixes.some(prefix => name.startsWith(prefix))) {
      continue;
    }
    
    const netInterfaces = nets[name];
    if (!netInterfaces) continue;
    
    for (const net of netInterfaces) {
      if (net.family === 'IPv4' && !net.internal) {
        const addr = net.address;
        if (addr.startsWith('100.')) {
          logger.info(`Detected Tailscale interface ${name} with IP ${addr} (last resort)`);
          return addr;
        }
      }
    }
  }
  
  logger.error('No suitable private IP address found');
  return null;
}

/**
 * These routes are called by Twake Drive frontend. The user's browser opens ( +) `${config.plugin.edition_url}/` (`index`).
 * The user is redirected from there to open directly the OnlyOffice edition server's web UI, with appropriate preview or not
 * and rights checks.
 */
class BrowserEditorController {
  /**
   * Opened by the user's browser, proxied through the Twake Drive backend. Checks access to the
   * file with the backend, then redirects the user to the `editor` method but directly on this
   * connector, not proxied by Twake Drive's backend anymore.
   */
  public index = async (req: Request<{}, {}, {}, RequestQuery>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { file_id, drive_file_id, company_id, preview, token } = req.query;
      const { user } = req;

      let driveFile: DriveFileType;
      if (drive_file_id) {
        //Append information about the drive file (versions, location, etc)
        driveFile = await driveService.get({
          drive_file_id,
          company_id,
          user_token: token,
        });

        if (!driveFile) {
          throw new Error('Drive file not found');
        }
      }

      //Get the file itself
      const file = await fileService.get({
        file_id: driveFile?.item?.last_version_cache?.file_metadata?.external_id || file_id,
        company_id,
      });

      if (!file) {
        throw new Error('File not found');
      }

      //Check whether the user has access to the file and put information to the office_token
      const hasAccess =
        (!driveFile && (file.user_id === user.id || preview)) ||
        ['manage', 'write'].includes(driveFile?.access) ||
        (driveFile?.access === 'read' && preview);

      if (!hasAccess) {
        throw new Error('You do not have access to this file');
      }

      let editingSessionKey = null;
      if (!preview) {
        editingSessionKey = await driveService.beginEditingSession(company_id, drive_file_id, token);
        //TODO catch error and display to the user when we can't stopped editing

        //TODO Log error with format to be able to set up grafana alert fir such king of errors
      }

      const officeToken = jwt.sign(
        {
          user_id: user.id, //To verify that link is opened by the same user
          company_id,
          drive_file_id,
          editing_session_key: editingSessionKey,
          file_id: file.id,
          file_name: driveFile?.item?.name || file.filename || file.metadata?.name || '',
          preview: !!preview,
        } as OfficeToken,
        CREDENTIALS_SECRET,
        {
          //one month, never expiring token
          expiresIn: 60 * 60 * 24 * 30,
        },
      );
      
      // Detect request origin to support both local and public access
      // Check X-Forwarded-Proto header for proxied requests (HTTPS behind reverse proxy)
      const forwardedProto = req.get('x-forwarded-proto');
      const protocol = forwardedProto || req.protocol || 'http';
      const host = req.get('host') || req.get('x-forwarded-host') || '';
      const requestOrigin = host ? `${protocol}://${host}` : undefined;
      
      res.redirect(
        makeURLTo.editorAbsolute({
          token,
          file_id,
          drive_file_id,
          editing_session_key: editingSessionKey,
          company_id,
          preview,
          office_token: officeToken,
        }, requestOrigin),
      );
    } catch (error) {
      next(error);
    }
  };

  /**
   * Renders this connector's view to initialise the Docs API client side component.
   */
  public editor = async (req: Request<{}, {}, {}, RequestEditorQuery>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { office_token } = req.query;
      const { user } = req;

      const officeTokenPayload = jwt.verify(office_token, CREDENTIALS_SECRET) as OfficeToken;
      const { preview, user_id, company_id, file_name, file_id, drive_file_id, editing_session_key } = officeTokenPayload;

      if (user_id !== user.id) {
        throw new Error('You do not have access to this link');
      }
      if (!preview && !editing_session_key) {
        throw new Error('Cant start editing without "editing session key"');
      }

      const initResponse = await editorService.init(company_id, file_name, file_id, user, preview, drive_file_id);

      const inPageToken = jwt.sign(
        {
          ...officeTokenPayload,
          in_page_token: true,
        } as OfficeToken,
        CREDENTIALS_SECRET,
      );

      // Detect request origin to use same hostname for OnlyOffice server (avoid CORS)
      const forwardedProto = req.get('x-forwarded-proto');
      const protocol = forwardedProto || req.protocol || 'http';
      const host = req.get('host') || req.get('x-forwarded-host') || '';
      
      // Build OnlyOffice server URL using same origin as the request
      let onlyofficeServerUrl = initResponse.onlyoffice_server;
      if (host) {
        // Extract hostname without port
        const hostname = host.split(':')[0];
        
        // Special case: if accessing via ryvie.local, use the machine's private IP instead
        // This avoids CORS Private Network Access issues with .local domains
        let targetHost = hostname;
        if (hostname === 'ryvie.local') {
          const privateIP = getPrivateIPAddress();
          if (privateIP) {
            targetHost = privateIP;
            logger.info(`Accessing via ryvie.local - using private IP ${privateIP} for OnlyOffice to avoid CORS`);
          }
        }
        
        // Use same hostname (or private IP) with OnlyOffice port (8090)
        onlyofficeServerUrl = `${protocol}://${targetHost}:8090/`;
        logger.info(`🔧 [editor] OnlyOffice Server URL finale: ${onlyofficeServerUrl} (host: ${host}, targetHost: ${targetHost})`);
      }

      res.render('index', {
        ...initResponse,
        onlyoffice_server: onlyofficeServerUrl,
        docId: preview ? file_id : editing_session_key,
        server: makeURLTo.rootAbsolute(),
        token: inPageToken,
      });
    } catch (error) {
      logger.error(error);
      next(error);
    }
  };
}

export default BrowserEditorController;
