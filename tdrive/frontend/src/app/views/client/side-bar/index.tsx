import { Button } from '@atoms/button/button';
import React, { useState, useRef } from 'react';
import {
  ClockIcon,
  CloudIcon,
  ExternalLinkIcon,
  HeartIcon,
  ShareIcon,
  TrashIcon,
  UserIcon,
  UserGroupIcon,
} from '@heroicons/react/outline';
import { useEffect, useCallback } from 'react';
import useRouterCompany from '@features/router/hooks/use-router-company';
import { useCurrentUser } from 'app/features/users/hooks/use-current-user';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { Title } from '../../../atoms/text';
import { useDriveItem } from '../../../features/drive/hooks/use-drive-item';
import { DriveCurrentFolderAtom } from '../body/drive/browser';
import { DriveNavigationState } from '../../../features/drive/state/store';
import Account from '../common/account';
import AppGrid from '../common/app-grid';
import DiskUsage from '../common/disk-usage';
import Actions from './actions';
import { useHistory } from 'react-router-dom';
import RouterServices from '@features/router/services/router-service';
import Languages from 'features/global/services/languages-service';
import FeatureTogglesService, {
  FeatureNames,
} from '@features/global/services/feature-toggles-service';
import Api from '@features/global/framework/api-service';
import JWTStorage from '@features/auth/jwt-storage-service';


export default () => {
  const history = useHistory();
  const { user } = useCurrentUser();
  const company = useRouterCompany();
  const { viewId, itemId, dirId } = RouterServices.getStateFromRoute();
  const [parentId, setParentId] = useRecoilState(
    DriveCurrentFolderAtom({ initialFolderId: viewId || 'user_' + user?.id }),
  );
  const setNavigationState = useSetRecoilState(DriveNavigationState);
  const [isNavigating, setIsNavigating] = useState(false);
  const lastNavigationTime = useRef(0);
  
  // Helper pour navigation instantanée optimisée (INP < 200ms)
  const navigateInstantly = useCallback((targetViewId: string, targetParentId: string) => {
    // Throttling avancé : éviter les clics trop rapprochés (< 100ms)
    const now = Date.now();
    if (now - lastNavigationTime.current < 100) return;
    lastNavigationTime.current = now;
    
    // Debouncing : éviter les clics multiples
    if (isNavigating) return;
    setIsNavigating(true);
    
    // 1. Feedback visuel IMMÉDIAT (0ms)
    setNavigationState({ isNavigating: true, targetViewId });
    
    // 2. Traitement asynchrone pour éviter le blocage
    requestAnimationFrame(() => {
      // Changement d'état en microtask (préchargement)
      setParentId(targetParentId);
      
      // URL update en arrière-plan
      setTimeout(() => {
        history.push(
          RouterServices.generateRouteFromState({
            companyId: company,
            viewId: targetViewId,
            itemId: '',
            dirId: '',
          }),
        );
        
        // Reset rapide avec délai minimal
        setTimeout(() => {
          setNavigationState({ isNavigating: false, targetViewId: null });
          setIsNavigating(false);
        }, 16); // 1 frame = 16ms
      }, 0);
    });
  }, [company, history, setNavigationState, setParentId, isNavigating]);
  
  const active = false;
  const { sharedWithMe, inTrash, path } = useDriveItem(parentId);
  const activeClass = 'bg-zinc-50 dark:bg-zinc-900 !text-blue-500';
  let folderType = 'home';
  if ((path || [])[0]?.id === 'user_' + user?.id) folderType = 'personal';
  if (inTrash) folderType = 'trash';
  if (sharedWithMe) folderType = 'shared';
  const [connectingDropbox, setConnectingDropbox] = useState(false);
  const [connectingGoogleDrive, setConnectingGoogleDrive] = useState(false);
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  
  // Détecter l'état de connexion basé sur la navigation et localStorage
  useEffect(() => {
    // Vérification réelle de la connexion backend pour chaque provider
    const checkRealConnections = async () => {
      if (!user?.email) return;
      
      const backendUrl = window.location.protocol + '//' + window.location.hostname + ':4000';
      const userEmail = encodeURIComponent(user.email);
      
      // Vérifier Dropbox
      try {
        console.log('🔍 Vérification connexion Dropbox...');
        const dropboxResponse = await fetch(`${backendUrl}/api/v1/files/rclone/list?path=&userEmail=${userEmail}&provider=dropbox`, {
          headers: {
            'Authorization': JWTStorage.getAutorizationHeader(),
            'Content-Type': 'application/json'
          }
        });
        
        if (dropboxResponse.ok) {
          console.log('✅ Dropbox connecté et fonctionnel');
          setDropboxConnected(true);
          localStorage.setItem('dropbox_connected', 'true');
        } else {
          console.warn('❌ Dropbox non accessible, nettoyage du cache');
          setDropboxConnected(false);
          localStorage.removeItem('dropbox_connected');
        }
      } catch (error) {
        console.error('❌ Erreur vérification Dropbox:', error);
        setDropboxConnected(false);
        localStorage.removeItem('dropbox_connected');
      }
      
      // Vérifier Google Drive
      try {
        console.log('🔍 Vérification connexion Google Drive...');
        const googleResponse = await fetch(`${backendUrl}/api/v1/files/rclone/list?path=&userEmail=${userEmail}&provider=googledrive`, {
          headers: {
            'Authorization': JWTStorage.getAutorizationHeader(),
            'Content-Type': 'application/json'
          }
        });
        
        if (googleResponse.ok) {
          console.log('✅ Google Drive connecté et fonctionnel');
          setGoogleDriveConnected(true);
          localStorage.setItem('googledrive_connected', 'true');
        } else {
          console.warn('❌ Google Drive non accessible, nettoyage du cache');
          setGoogleDriveConnected(false);
          localStorage.removeItem('googledrive_connected');
        }
      } catch (error) {
        console.error('❌ Erreur vérification Google Drive:', error);
        setGoogleDriveConnected(false);
        localStorage.removeItem('googledrive_connected');
      }
    };
    
    checkRealConnections();
  }, [user?.email]);




  useEffect(() => {
    !itemId && !dirId && viewId && setParentId(viewId);
    dirId && viewId && setParentId(dirId);
  }, [viewId, itemId, dirId]);
  return (
    <div className="grow flex flex-col overflow-auto -m-4 p-4 relative testid:sidebar">
      <div className="grow">
        <div className="sm:hidden block mb-2">
          <div className="flex flex-row space-between w-full">
            <div className="flex items-center order-1 grow">
              <img
                src="/public/img/logo/logo-text-black.svg"
                className="h-6 ml-1 dark:hidden block"
                alt="Tdrive"
              />
              <img
                src="/public/img/logo/logo-text-white.svg"
                className="h-6 ml-1 dark:block hidden"
                alt="Tdrive"
              />
            </div>
            <div className="md:grow order-3 md:order-2">
              <Account />
            </div>
            <div className="order-2 md:order-3 mr-2 md:mr-0">
              <AppGrid />
            </div>
          </div>

          <div className="mt-6" />
          <Title>Actions</Title>
        </div>

        <Actions />

        <div className="mt-4" />
        <Title>Drive</Title>
        <Button
          onClick={() => {
            navigateInstantly('user_' + user?.id, 'user_' + user?.id);
          }}
          size="lg"
          theme="white"
          className={
            'w-full mb-1 ' +
            (folderType === 'personal' && (viewId == '' || viewId == 'user_' + user?.id)
              ? activeClass
              : '')
          }
          testClassId="sidebar-menu-my-drive"
        >
          <UserIcon className="w-5 h-5 mr-4" /> {Languages.t('components.side_menu.my_drive')}
        </Button>
        {FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_SHARED_DRIVE) && (
          <Button
            onClick={() => {
              navigateInstantly('root', 'root');
            }}
            size="lg"
            theme="white"
            className={
              'w-full mb-1 ' + (folderType === 'home' && viewId == 'root' ? activeClass : '')
            }
            testClassId="sidebar-menu-shared-drive"
          >
            <CloudIcon className="w-5 h-5 mr-4" /> {Languages.t('components.side_menu.home')}
          </Button>
        )}
        {FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_MANAGE_ACCESS) && (
          <Button
            onClick={() => {
              navigateInstantly('shared_with_me', 'shared_with_me');
            }}
            size="lg"
            theme="white"
            className={
              'w-full mb-1 ' +
              (folderType === 'shared' && viewId == 'shared_with_me' ? activeClass : '')
            }
            testClassId="sidebar-menu-share-with-me"
          >
            <UserGroupIcon className="w-5 h-5 mr-4" />{' '}
            {Languages.t('components.side_menu.shared_with_me')}
          </Button>
        )}
        {false && (
          <>
            <Button
              size="lg"
              theme="white"
              className={'w-full mb-1 ' + (!active ? activeClass : '')}
            >
              <ClockIcon className="w-5 h-5 mr-4" /> Recent
            </Button>
            <Button
              size="lg"
              theme="white"
              className={'w-full mb-1 ' + (!active ? activeClass : '')}
            >
              <HeartIcon className="w-5 h-5 mr-4" /> Favorites
            </Button>
          </>
        )}
        <Button
          onClick={() => {
            navigateInstantly('trash_' + user?.id, 'trash_' + user?.id);
          }}
          size="lg"
          theme="white"
          className={'w-full mb-1 ' + (folderType === 'trash' ? activeClass : '')}
          testClassId="sidebar-menu-trash"
        >
          <TrashIcon className="w-5 h-5 mr-4" />{' '}
          {Languages.t('components.side_menu.trash')}
        </Button>

        {/* Bouton Dropbox dynamique */}
        <Button
          onClick={async () => {
            if (!user) {
              alert('Aucun utilisateur connecté');
              return;
            }

            if (dropboxConnected) {
              // Si connecté, naviguer vers My Dropbox
              setParentId('dropbox_root');
              history.push(`/client/${company}/v/dropbox_root`);
            } else {
              // Si pas connecté, initier la connexion OAuth
              setConnectingDropbox(true);
              try {
                console.log('🔗 Connexion Dropbox pour l\'utilisateur:', user);
                
                const backendUrl = window.location.protocol + '//' + window.location.hostname + ':4000';
                const userEmail = encodeURIComponent(user.email);
                const response = await fetch(`${backendUrl}/v1/drivers/Dropbox?userEmail=${userEmail}`);
                
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (data && data.addition && data.addition.AuthUrl) {
                  console.log('🔀 Redirection vers Dropbox OAuth:', data.addition.AuthUrl);
                  // Marquer comme connecté après redirection OAuth réussie
                  localStorage.setItem('dropbox_connected', 'true');
                  window.location.href = data.addition.AuthUrl;
                } else {
                  throw new Error('Invalid response format');
                }
              } catch (e) {
                console.error('Dropbox connection error:', e);
                setConnectingDropbox(false);
              }
            }
          }}
          size="lg"
          theme="white"
          className={`w-full mb-1 ${dropboxConnected && (parentId === 'dropbox_root' || parentId.startsWith('dropbox_')) ? activeClass : ''}`}
          testClassId={dropboxConnected ? "sidebar-dropbox-browse" : "sidebar-dropbox-connect"}
          disabled={connectingDropbox}
        >
          <img 
            src="https://cfl.dropboxstatic.com/static/images/favicon-vfl8lUR9B.ico" 
            alt="Dropbox" 
            className="w-5 h-5 mr-4"
          />
          {connectingDropbox 
            ? 'Redirecting to Dropbox...' 
            : dropboxConnected 
              ? 'My Dropbox' 
              : 'Connect your Dropbox'}
        </Button>

        {/* Bouton Google Drive dynamique */}
        <Button
          onClick={async () => {
            if (!user) {
              alert('Aucun utilisateur connecté');
              return;
            }

            if (googleDriveConnected) {
              // Si connecté, naviguer vers My Google Drive
              setParentId('googledrive_root');
              history.push(`/client/${company}/v/googledrive_root`);
            } else {
              // Si pas connecté, initier la connexion OAuth
              setConnectingGoogleDrive(true);
              try {
                console.log('🔗 Connexion Google Drive pour l\'utilisateur:', user);
                
                const backendUrl = window.location.protocol + '//' + window.location.hostname + ':4000';
                const userEmail = encodeURIComponent(user.email);
                const response = await fetch(`${backendUrl}/v1/drivers/GoogleDrive?userEmail=${userEmail}`);
                
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (data && data.addition && data.addition.AuthUrl) {
                  console.log('🔀 Redirection vers Google Drive OAuth:', data.addition.AuthUrl);
                  // Marquer comme connecté après redirection OAuth réussie
                  localStorage.setItem('googledrive_connected', 'true');
                  window.location.href = data.addition.AuthUrl;
                } else {
                  throw new Error('Invalid response format');
                }
              } catch (e) {
                console.error('Google Drive connection error:', e);
                setConnectingGoogleDrive(false);
              }
            }
          }}
          size="lg"
          theme="white"
          className={`w-full mb-1 ${googleDriveConnected && (parentId === 'googledrive_root' || parentId.startsWith('googledrive_')) ? activeClass : ''}`}
          testClassId={googleDriveConnected ? "sidebar-googledrive-browse" : "sidebar-googledrive-connect"}
          disabled={connectingGoogleDrive}
        >
          <img 
            src="https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" 
            alt="Google Drive" 
            className="w-5 h-5 mr-4"
          />
          {connectingGoogleDrive 
            ? 'Redirecting to Google Drive...' 
            : googleDriveConnected 
              ? 'My Google Drive' 
              : 'Connect your Google Drive'}
        </Button>

        {false && (
          <>
            <div className="mt-4" />
            <Title>Shared</Title>
            <Button
              size="lg"
              theme="white"
              className={'w-full mt-2 mb-1 ' + (!inTrash ? activeClass : '')}
            >
              <ShareIcon className="w-5 h-5 mr-4" /> Shared with me
            </Button>
            <Button
              size="lg"
              theme="white"
              className={'w-full mb-1 ' + (inTrash ? activeClass : '')}
            >
              <ExternalLinkIcon className="w-5 h-5 mr-4" /> Shared by me
            </Button>
          </>
        )}
      </div>

      <div className="">
        <DiskUsage />
      </div>
    </div>
  );
};
