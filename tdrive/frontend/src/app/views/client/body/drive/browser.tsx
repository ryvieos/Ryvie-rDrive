import { ChevronDownIcon, RefreshIcon, ViewGridIcon, ViewListIcon, TrashIcon, DotsVerticalIcon } from '@heroicons/react/outline';
import { Button } from '@atoms/button/button';
import { Base, BaseSmall, Subtitle, Title } from '@atoms/text';
import Menu from '@components/menus/menu';
import { getFilesTree } from '@components/uploads/file-tree-utils';
import UploadZone from '@components/uploads/upload-zone';
import { setTdriveTabToken } from '@features/drive/api-client/api-client';
import { useDriveItem } from '@features/drive/hooks/use-drive-item';
import { useDriveUpload } from '@features/drive/hooks/use-drive-upload';
import { DriveItemSelectedList, DriveItemSort, DriveNavigationState } from '@features/drive/state/store';
import { formatBytes } from '@features/drive/utils';
import useRouterCompany from '@features/router/hooks/use-router-company';
import JWTStorage from '@features/auth/jwt-storage-service';
import _ from 'lodash';
import { memo, Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { atomFamily, useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import { DrivePreview } from '../../viewer/drive-preview';
import {
  useOnBuildContextMenu,
  useOnBuildFileTypeContextMenu,
  useOnBuildPeopleContextMenu,
  useOnBuildDateContextMenu,
  useOnBuildSortContextMenu,
} from './context-menu';
import { DocumentRow, DocumentRowOverlay } from './documents/document-row';
import { useDrivePreview } from '@features/drive/hooks/use-drive-preview';
import { FolderRow } from './documents/folder-row';
import { FolderRowSkeleton } from './documents/folder-row-skeleton';
import HeaderPath from './header-path';
import { ConfirmDeleteModal } from './modals/confirm-delete';
import { ConfirmTrashModal } from './modals/confirm-trash';
import { ConfirmDeleteModalAtom } from './modals/confirm-delete';
import { ConfirmTrashModalAtom } from './modals/confirm-trash';
import { CreateModalAtom } from './modals/create';
import { UploadModelAtom } from './modals/upload';
import { PropertiesModal } from './modals/properties';
import { AccessModal } from './modals/update-access';
import { SharedDriveModal } from './modals/shared-drive-access';
import { PublicLinkModal } from './modals/public-link';
import { VersionsModal } from './modals/versions';
import { UsersModal } from './modals/manage-users';
import { SharedFilesTable } from './shared-files-table';
import RouterServices from '@features/router/services/router-service';
import useRouteState from 'app/features/router/hooks/use-route-state';
import { SharedWithMeFilterState } from '@features/drive/state/shared-with-me-filter';
import MenusManager from '@components/menus/menus-manager.jsx';
import Languages from 'features/global/services/languages-service';
import { DndContext, useSensors, useSensor, PointerSensor, DragOverlay } from '@dnd-kit/core';
import { Droppable } from 'app/features/dragndrop/hook/droppable';
import { Draggable } from 'app/features/dragndrop/hook/draggable';
import { useDriveActions } from '@features/drive/hooks/use-drive-actions';
import { useCloudImport } from '@features/drive/hooks/use-cloud-import';
import { ConfirmModalAtom } from './modals/confirm-move/index';
import { useCurrentUser } from 'app/features/users/hooks/use-current-user';
import { ToasterService } from '@features/global/services/toaster-service';
import { ConfirmModal } from './modals/confirm-move';
import { useHistory } from 'react-router-dom';
import { SortIcon } from 'app/atoms/icons-agnostic';
import { useUploadExp } from 'app/features/files/hooks/use-exp-upload';
import GalleryView from './components/gallery-view';

export const DriveCurrentFolderAtom = atomFamily<
  string,
  { context?: string; initialFolderId: string }
>({
  key: 'DriveCurrentFolderAtom',
  default: options => options.initialFolderId || 'root',
});

export default memo(
  ({
    context,
    initialParentId,
    tdriveTabContextToken,
    inPublicSharing,
  }: {
    context?: string;
    initialParentId?: string;
    tdriveTabContextToken?: string;
    inPublicSharing?: boolean;
  }) => {
    const { user } = useCurrentUser();
    const companyId = useRouterCompany();
    const history = useHistory();
    const role = user
      ? (user?.companies || []).find(company => company?.company.id === companyId)?.role
      : 'member';
    setTdriveTabToken(tdriveTabContextToken || null);
    const [filter] = useRecoilState(SharedWithMeFilterState);
    const { viewId, dirId, itemId } = useRouteState();
    const [sortLabel] = useRecoilState(DriveItemSort);
    const [parentId, _setParentId] = useRecoilState(
      DriveCurrentFolderAtom({
        context: context,
        initialFolderId: dirId || viewId || initialParentId || 'user_' + user?.id,
      }),
    );

    // set the initial view to the user's home directory
    useEffect(() => {
      !dirId &&
        !viewId &&
        history.push(RouterServices.generateRouteFromState({ viewId: parentId }));
    }, [viewId, dirId]);

    const [loadingParentChange, setLoadingParentChange] = useState(false);
    const navigationState = useRecoilValue(DriveNavigationState);
    
    const {
      sharedWithMe,
      details,
      access,
      item,
      inTrash,
      refresh,
      children,
      loading: loadingParent,
      path,
      loadNextPage,
      paginateItem,
    } = useDriveItem(parentId);
    const { uploadTree } = useDriveUpload();
    const { uploadTree: _uploadTree } = useUploadExp();

    // Chargement optimisé : navigation instantanée + chargement des données
    const loading = loadingParent || loadingParentChange;
    const isNavigatingInstantly = navigationState.isNavigating;
    
    // Mémoisation des items pour éviter les re-calculs coûteux
    const memoizedItems = useMemo(() => children || [], [children]);
    const itemsCount = memoizedItems.length;
    
    // Virtualisation légère pour les grandes listes
    const VIRT_PAGE_SIZE = 200;
    const VIRT_THRESHOLD = 100; // déclenchement de chargement quand on s'approche du bas
    const shouldVirtualize = itemsCount > VIRT_PAGE_SIZE;
    const [visibleRange, setVisibleRange] = useState({
      start: 0,
      end: shouldVirtualize ? Math.min(VIRT_PAGE_SIZE, itemsCount) : itemsCount,
    });
    
    // Réinitialiser la fenêtre visible lors d'un changement d'items
    useEffect(() => {
      setVisibleRange({ start: 0, end: shouldVirtualize ? Math.min(VIRT_PAGE_SIZE, itemsCount) : itemsCount });
    }, [itemsCount, shouldVirtualize]);
    
    const visibleItems = useMemo(() => {
      return shouldVirtualize 
        ? memoizedItems.slice(visibleRange.start, visibleRange.end)
        : memoizedItems;
    }, [memoizedItems, visibleRange, shouldVirtualize]);

    const uploadZone = 'drive_' + companyId;
    const uploadZoneRef = useRef<UploadZone | null>(null);

    const setCreationModalState = useSetRecoilState(CreateModalAtom);
    const setUploadModalState = useSetRecoilState(UploadModelAtom);

    const [checked, setChecked] = useRecoilState(DriveItemSelectedList);

    const setParentId = useCallback(
      async (id: string) => {
        setLoadingParentChange(true);
        try {
          await refresh(id);
          _setParentId(id);
        } catch (e) {
          console.error(e);
        }
        setLoadingParentChange(false);
      },
      [_setParentId],
    );

    useEffect(() => {
      setChecked({});
      refresh(parentId);
    }, [parentId, refresh, filter]);

    const items =
      item?.is_directory === false
        ? //We use this hack for public shared single file
          item
          ? [item]
          : []
        : children;

    const documents = items.filter(i => !i.is_directory);

    const selectedCount = Object.values(checked).filter(v => v).length;
    const selectedItems = useMemo(() => (children || []).filter(c => checked[c.id]), [children, checked]);

    const onBuildContextMenu = useOnBuildContextMenu(children, initialParentId, inPublicSharing);
    const onBuildSortContextMenu = useOnBuildSortContextMenu();

    const handleDragOver = (event: { preventDefault: () => void }) => {
      event.preventDefault();
    };
    const handleDrop = async (event: { dataTransfer: any; preventDefault: () => void }) => {
      event.preventDefault();
      const dataTransfer = event.dataTransfer;
      if (dataTransfer) {
        const tree = await getFilesTree(dataTransfer);
        setCreationModalState({ parent_id: '', open: false });
        await uploadTree(tree, {
          companyId,
          parentId,
        });
      }
    };

    const buildFileTypeContextMenu = useOnBuildFileTypeContextMenu();
    const buildPeopleContextMen = useOnBuildPeopleContextMenu();
    const buildDateContextMenu = useOnBuildDateContextMenu();
    const setConfirmModalState = useSetRecoilState(ConfirmModalAtom);
    const setConfirmDeleteModalState = useSetRecoilState(ConfirmDeleteModalAtom);
    const setConfirmTrashModalState = useSetRecoilState(ConfirmTrashModalAtom);
    const [activeIndex, setActiveIndex] = useState(null);
    const [activeChild, setActiveChild] = useState(null);
    const { update } = useDriveActions();
    const { importing: importingDropbox, importDropboxFolder } = useCloudImport();
    // État d'import séparé pour Google Drive
    const [importingGoogleDrive, setImportingGoogleDrive] = useState(false);
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: {
          distance: 8,
        },
      }),
    );
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Marquee selection state
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectOrigin, setSelectOrigin] = useState<{ x: number; y: number } | null>(null);
    const [selectRect, setSelectRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

    const updateSelectionFromRect = useCallback((rect: DOMRect) => {
      const container = scrollViewer.current;
      if (!container) return;
      const elements = Array.from(container.querySelectorAll('[id^="DR-"]')) as HTMLElement[];
      const nextChecked: Record<string, boolean> = {};
      elements.forEach(el => {
        const elRect = el.getBoundingClientRect();
        const intersect = !(rect.right < elRect.left || rect.left > elRect.right || rect.bottom < elRect.top || rect.top > elRect.bottom);
        if (intersect) {
          const id = el.id.replace('DR-', '');
          nextChecked[id] = true;
        }
      });
      setChecked(nextChecked);
    }, [setChecked]);

    const onMouseDownScroll = useCallback((e: React.MouseEvent) => {
      if (e.button !== 0) return; // only left click
      const container = scrollViewer.current;
      if (!container) return;
      // start selection when dragging on the background, not on items
      const target = e.target as HTMLElement;
      const inItem = target.closest('[id^="DR-"]');
      if (inItem) return;
      // Background click: clear current selection immediately
      setChecked({});
      const startX = e.clientX;
      const startY = e.clientY;
      setIsSelecting(true);
      setSelectOrigin({ x: startX, y: startY });
      setSelectRect({ left: startX, top: startY, width: 0, height: 0 });
      e.preventDefault();
    }, []);

    const onMouseMoveWindow = useCallback((e: MouseEvent) => {
      if (!isSelecting || !selectOrigin) return;
      const x1 = selectOrigin.x;
      const y1 = selectOrigin.y;
      const x2 = e.clientX;
      const y2 = e.clientY;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      setSelectRect({ left, top, width, height });
      const rect = new DOMRect(left, top, width, height);
      updateSelectionFromRect(rect);
    }, [isSelecting, selectOrigin, updateSelectionFromRect]);

    const onMouseUpWindow = useCallback(() => {
      if (!isSelecting) return;
      setIsSelecting(false);
      setSelectOrigin(null);
      // keep the final rect briefly (optional), then clear it
      setTimeout(() => setSelectRect(null), 0);
    }, [isSelecting]);

    useEffect(() => {
      window.addEventListener('mousemove', onMouseMoveWindow);
      window.addEventListener('mouseup', onMouseUpWindow);
      return () => {
        window.removeEventListener('mousemove', onMouseMoveWindow);
        window.removeEventListener('mouseup', onMouseUpWindow);
      };
    }, [onMouseMoveWindow, onMouseUpWindow]);

    function handleDragStart(event: any) {
      setActiveIndex(event.active.id);
      setActiveChild(event.active.data.current.child.props.item);
    }
    function handleDragEnd(event: any) {
      setActiveIndex(null);
      setActiveChild(null);
      if (event.over) {
        setConfirmModalState({
          open: true,
          parent_id: inTrash ? 'root' : event.over.data.current.child.props.item.id,
          mode: 'move',
          title:
            Languages.t('components.item_context_menu.move.modal_header') +
            ` '${event.active.data.current.child.props.item.name}'`,
          onSelected: async ids => {
            await update(
              {
                parent_id: ids[0],
              },
              event.active.data.current.child.props.item.id,
              event.active.data.current.child.props.item.parent_id,
            );
          },
        });
      }
    }

    function draggableMarkup(index: number, child: any) {
      const commonProps = {
        key: index,
        className:
          (index === 0 ? 'rounded-t-md ' : '-mt-px ') +
          (index === items.length - 1 ? 'rounded-b-md ' : '') +
          'border-0 md:border',
        item: child,
        checked: checked[child.id] || false,
        onCheck: (v: boolean) => setChecked(_.pickBy({ ...checked, [child.id]: v }, _.identity)),
        onBuildContextMenu: () => onBuildContextMenu(details, child),
        inPublicSharing,
      };
      return isMobile ? (
        <DocumentRow {...commonProps} />
      ) : (
        <Draggable id={index} key={index}>
          <DocumentRow {...commonProps} />
        </Draggable>
      );
    }

    // Infinite scroll
    const scrollViewer = useRef<HTMLDivElement>(null);

    const handleScroll = async () => {
      const el = scrollViewer.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const nearBottom = scrollTop + clientHeight + VIRT_THRESHOLD >= scrollHeight;

      // Étendre la fenêtre visible côté client pour grandes listes
      if (shouldVirtualize && nearBottom && visibleRange.end < itemsCount) {
        setVisibleRange((v: { start: number; end: number }) => ({ start: 0, end: Math.min(v.end + VIRT_PAGE_SIZE, itemsCount) }));
      }

      // Continuer à charger côté store quand nécessaire
      if (scrollTop > 0 && scrollTop + clientHeight >= scrollHeight) {
        await loadNextPage(parentId);
      }
    };

    useEffect(() => {
      if (!loading)
        scrollViewer.current?.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        scrollViewer.current?.removeEventListener('scroll', handleScroll);
      };
    }, [parentId, loading]);

    // Scroll to item in view
    const scrollTillItemInView = itemId && itemId?.length > 0;
    const scrollItemId = itemId || '';

    useEffect(() => {
      const itemInChildren = children.find(item => item.id === scrollItemId);
      if (!loading && scrollTillItemInView && !itemInChildren) {
        scrollViewer.current?.scrollTo(0, scrollViewer.current?.scrollHeight);
      } else {
        if (!loading && itemInChildren) {
          // scroll to preview item using id for current preview routes
          const element = document.getElementById(`DR-${scrollItemId}`);
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // set it as checked to indicate it is in view
          setChecked({ [scrollItemId]: true });
        }
      }
    }, [loading, children]);

    // Determine the number of items that can fit within the scroll viewer's visible area before the scrollbar appears.
    const getItemsPerPage = useCallback(() => {
      const scrollViewerElement = scrollViewer?.current || null;
      const itemHeight = scrollViewerElement?.firstElementChild?.clientHeight || 0;
      const viewerHeight = scrollViewerElement?.clientHeight || 0;
      return itemHeight > 0 ? Math.ceil(viewerHeight / itemHeight) : 0;
    }, []);

    const [itemsPerPage, setItemsPerPage] = useState(0);

    const handleResize = useCallback(() => {
      setItemsPerPage(getItemsPerPage());
    }, [getItemsPerPage]);

    useEffect(() => {
      handleResize(); // intially set the items per page for the current view
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [handleResize]);

    // Load additional pages as needed to ensure the scrollbar remains visible
    useEffect(() => {
      const currentPage = Math.floor((paginateItem?.page || 1) / (paginateItem?.limit || 1));
      const targetPages = Math.ceil(itemsPerPage / (paginateItem?.limit || 1));

      if (!loading && currentPage < targetPages) {
        loadNextPage(parentId);
      }
    }, [paginateItem, loading, parentId, itemsPerPage]);

    const [isPreparingUpload, setIsPreparingUpload] = useState(false);
    
    // Mémoisation des handlers de boutons pour éviter les re-renders coûteux
    const uploadItemModal = useCallback(() => {
      if (item?.id) setUploadModalState({ open: true, parent_id: item.id });
    }, [item?.id, setUploadModalState]);
    
    const handleUploadPrepare = useCallback(() => {
      setIsPreparingUpload(true);
    }, []);
    
    const handleUploadComplete = useCallback(() => {
      setIsPreparingUpload(false);
    }, []);
    

    
    // Lazy loading des boutons pour éviter le rendu coûteux
    const [buttonsVisible, setButtonsVisible] = useState(false);
    
    useEffect(() => {
      // Délai minimal pour afficher les boutons après le rendu principal
      const timer = setTimeout(() => setButtonsVisible(true), 0);
      return () => clearTimeout(timer);
    }, []);

    // Détecter si on est dans une vue Dropbox
    const isDropboxView = parentId?.startsWith('dropbox_');
    
    // Détecter si on est dans une vue Google Drive
    const isGoogleDriveView = parentId?.startsWith('googledrive_');
    
    // Fonction pour synchroniser les fichiers Dropbox
    const handleDropboxSync = useCallback(async () => {
      if (!isDropboxView) return;
      
      // Extraire le chemin Dropbox du parentId
      const dropboxPath = parentId === 'dropbox_root' ? '' : parentId.replace('dropbox_', '').replace(/_/g, '/');
      
      try {
        await importDropboxFolder(dropboxPath, 'user_' + user?.id);
      } catch (error) {
        console.error('Erreur lors de la synchronisation Dropbox:', error);
      }
    }, [isDropboxView, parentId, importDropboxFolder, user?.id]);
    
    // Fonction pour synchroniser les fichiers Google Drive
    const handleGoogleDriveSync = useCallback(async () => {
      if (!isGoogleDriveView || importingGoogleDrive) return;
      
      // Extraire le chemin Google Drive du parentId
      const googleDrivePath = parentId === 'googledrive_root' ? '' : parentId.replace('googledrive_', '').replace(/_/g, '/');
      
      setImportingGoogleDrive(true);
      try {
        // Synchroniser vers un dossier Google Drive séparé pour éviter le mélange avec Dropbox
        await importDropboxFolder(googleDrivePath, 'user_' + user?.id, { provider: 'googledrive' });
      } catch (error) {
        console.error('Erreur lors de la synchronisation Google Drive:', error);
      } finally {
        setImportingGoogleDrive(false);
      }
    }, [isGoogleDriveView, parentId, importDropboxFolder, user?.id, importingGoogleDrive]);

    // View mode: list (default) or gallery, persisted in localStorage
    const [viewMode, setViewMode] = useState<'list' | 'gallery'>(() => {
      try {
        const saved = localStorage.getItem('drive_view_mode');
        return (saved === 'gallery' || saved === 'list') ? (saved as 'list' | 'gallery') : 'list';
      } catch {
        return 'list';
      }
    });
    useEffect(() => {
      try { localStorage.setItem('drive_view_mode', viewMode); } catch {}
    }, [viewMode]);

    const { open: openPreview } = useDrivePreview();

    return (
      <>
        {viewId == 'shared-with-me' ? (
          <>
            <Suspense fallback={<></>}>
              <DrivePreview items={documents} />
            </Suspense>
            <SharedFilesTable />
          </>
        ) : (
          <UploadZone
            overClassName={''}
            className="h-full overflow-hidden"
            disableClick
            parent={''}
            multiple={true}
            allowPaste={true}
            ref={uploadZoneRef}
            driveCollectionKey={uploadZone}
            onPrepareUpload={handleUploadPrepare}
            onFinishUpload={handleUploadComplete}
            onAddFiles={async (_, event) => {
              const tree = await getFilesTree(event);
              setCreationModalState({ parent_id: '', open: false });
              await uploadTree(tree, {
                companyId,
                parentId,
              });
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            disabled={inTrash || access === 'read'}
            testClassId="browser-upload-zone"
          >
            {role == 'admin' && <UsersModal />}
            <VersionsModal />
            <AccessModal />
            <SharedDriveModal />
            <PublicLinkModal />
            <PropertiesModal />
            <ConfirmDeleteModal />
            <ConfirmTrashModal />
            <ConfirmModal />
            <Suspense fallback={<></>}>
              <DrivePreview items={documents} />
            </Suspense>
            <div
              className={
                'flex flex-col grow h-full overflow-hidden ' +
                (loading && (!items?.length || loadingParentChange) ? 'opacity-50 ' : '')
              }
            >
              <div
                className={`flex flex-row shrink-0 items-center mb-4 ${
                  !sharedWithMe ? 'flex-wrap' : ''
                } border-b md:border-b-0 px-4 py-2 md:px-0 md:py-0`}
              >
                {sharedWithMe ? (
                  <div>
                    <Title className="mb-4 block">
                      {Languages.t('scenes.app.shared_with_me.shared_with_me')}
                    </Title>
                    {/* Filters */}
                    <div className="flex items-center space-x-4 mb-6">
                      <div className="">
                        <Button
                          theme="secondary"
                          className="flex items-center"
                          onClick={evt => {
                            MenusManager.openMenu(
                              buildFileTypeContextMenu(),
                              { x: evt.clientX, y: evt.clientY },
                              'center',
                              undefined,
                              'browser-share-with-me-menu-file-type',
                            );
                          }}
                          testClassId="button-open-menu-file-type"
                        >
                          <span>
                            {filter.mimeType.key && filter.mimeType.key != 'All'
                              ? filter.mimeType.key
                              : Languages.t('scenes.app.shared_with_me.file_type')}
                          </span>
                          <ChevronDownIcon className="h-4 w-4 ml-2 -mr-1" />
                        </Button>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          theme="secondary"
                          className="flex items-center"
                          onClick={evt => {
                            MenusManager.openMenu(
                              buildPeopleContextMen(),
                              { x: evt.clientX, y: evt.clientY },
                              'center',
                              undefined,
                              'browser-share-with-me-menu-people',
                            );
                          }}
                          testClassId="button-open-menu-people"
                        >
                          <span>{Languages.t('scenes.app.shared_with_me.people')}</span>
                          <ChevronDownIcon className="h-4 w-4 ml-2 -mr-1" />
                        </Button>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Button
                          theme="secondary"
                          className="flex items-center"
                          onClick={evt => {
                            MenusManager.openMenu(
                              buildDateContextMenu(),
                              { x: evt.clientX, y: evt.clientY },
                              'center',
                              undefined,
                              'browser-share-with-me-menu-last-modified',
                            );
                          }}
                          testClassId="button-open-menu-last-modified"
                        >
                          <span>
                            {filter.date.key && filter.date.key != 'All'
                              ? filter.date.key
                              : Languages.t('scenes.app.shared_with_me.last_modified')}
                          </span>
                          <ChevronDownIcon className="h-4 w-4 ml-2 -mr-1" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <HeaderPath
                    path={path || []}
                    inTrash={inTrash}
                    setParentId={setParentId}
                    inPublicSharing={inPublicSharing}
                  />
                )}
                <div className="grow" />

                {access !== 'read' && (
                  <BaseSmall className="hidden md:block">
                    {formatBytes(item?.size || 0)} {Languages.t('scenes.app.drive.used')}
                  </BaseSmall>
                )}

                {buttonsVisible && (
                  <Menu
                    menu={() => onBuildSortContextMenu()}
                    sortData={sortLabel}
                    testClassId="browser-menu-sorting"
                  >
                    {' '}
                    <Button
                    theme="outline"
                    className="ml-4 flex flex-row items-center border-0 md:border !text-gray-500 md:!text-blue-500 px-0 md:px-4"
                    testClassId="button-sorting"
                  >
                    <SortIcon
                      className={`h-4 w-4 mr-2 -ml-1 ${
                        sortLabel.order === 'asc' ? 'transform rotate-180' : ''
                      }`}
                    />
                    <span>
                      {Languages.t('components.item_context_menu.sorting.selected.' + sortLabel.by)}
                    </span>
                    <ChevronDownIcon className="h-4 w-4 ml-2 -mr-1" />
                    </Button>
                  </Menu>
                )}
                {buttonsVisible && (
                  <Button
                    theme="outline"
                    className="ml-2 flex flex-row items-center border-0 md:border !text-gray-500 md:!text-blue-500 px-2 md:px-3"
                    onClick={() => setViewMode(v => (v === 'list' ? 'gallery' : 'list'))}
                    testClassId="button-toggle-view"
                  >
                    {viewMode === 'list' ? (
                      <>
                        <ViewGridIcon className="h-4 w-4 mr-2 -ml-1" />
                        <span>Galerie</span>
                      </>
                    ) : (
                      <>
                        <ViewListIcon className="h-4 w-4 mr-2 -ml-1" />
                        <span>Liste</span>
                      </>
                    )}
                  </Button>
                )}

                {/* Bulk actions when selection exists */}
                {selectedCount > 0 && buttonsVisible && (
                  <>
                    <Button
                      theme={'secondary'}
                      className="ml-2 flex flex-row items-center border-0 md:border !text-gray-500 md:!text-red-600 px-2 md:px-3"
                      disabled={access !== 'manage'}
                      onClick={() => {
                        if (inTrash) {
                          setConfirmDeleteModalState({ open: true, items: selectedItems as any });
                        } else {
                          setConfirmTrashModalState({ open: true, items: selectedItems as any });
                        }
                      }}
                      testClassId="button-bulk-delete"
                    >
                      <TrashIcon className="h-4 w-4 mr-2 -ml-1" />
                      <span>{inTrash ? 'Supprimer' : 'Corbeille'}</span>
                    </Button>

                    <Menu menu={() => onBuildContextMenu(details, selectedCount === 1 ? selectedItems[0] : undefined)} testClassId="browser-menu-bulk-actions">
                      <Button
                        theme="secondary"
                        className="ml-2 flex flex-row items-center bg-transparent md:bg-blue-500 md:bg-opacity-25 !text-gray-500 md:!text-blue-500 px-2 md:px-3"
                        testClassId="button-bulk-actions"
                      >
                        <DotsVerticalIcon className="h-5 w-5" />
                      </Button>
                    </Menu>
                  </>
                )}
                
                {/* Bouton de synchronisation Dropbox */}
                {isDropboxView && buttonsVisible && (
                  <Button
                    theme="outline"
                    className="ml-4 flex flex-row items-center border-0 md:border !text-gray-500 md:!text-blue-500 px-0 md:px-4"
                    onClick={handleDropboxSync}
                    disabled={importingDropbox}
                    testClassId="button-dropbox-sync"
                  >
                    <RefreshIcon 
                      className={`h-4 w-4 mr-2 -ml-1 ${importingDropbox ? 'animate-spin' : ''}`} 
                    />
                    <span>
                      {importingDropbox ? 'Synchronisation...' : 'Synchroniser avec Mon disque'}
                    </span>
                  </Button>
                )}
                
                {/* Bouton de synchronisation Google Drive */}
                {isGoogleDriveView && buttonsVisible && (
                  <Button
                    theme="outline"
                    className="ml-4 flex flex-row items-center border-0 md:border !text-gray-500 md:!text-blue-500 px-0 md:px-4"
                    onClick={handleGoogleDriveSync}
                    disabled={importingGoogleDrive}
                    testClassId="button-googledrive-sync"
                  >
                    <RefreshIcon 
                      className={`h-4 w-4 mr-2 -ml-1 ${importingGoogleDrive ? 'animate-spin' : ''}`} 
                    />
                    <span>
                      {importingGoogleDrive ? 'Synchronisation...' : 'Synchroniser avec Mon disque'}
                    </span>
                  </Button>
                )}
                
                {viewId !== 'shared_with_me' && buttonsVisible && (
                  <Menu menu={() => onBuildContextMenu(details)} testClassId="browser-menu-more">
                    {' '}
                    <Button
                      theme="secondary"
                      className="ml-4 flex flex-row items-center bg-transparent md:bg-blue-500 md:bg-opacity-25 !text-gray-500 md:!text-blue-500 px-0 md:px-4"
                      testClassId="button-more"
                    >
                      <span>
                        {selectedCount > 1
                          ? `${selectedCount} items`
                          : Languages.t('scenes.app.drive.context_menu')}{' '}
                      </span>

                      <ChevronDownIcon className="h-4 w-4 ml-2 -mr-1" />
                    </Button>
                  </Menu>
                )}
              </div>

              <DndContext sensors={sensors} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
                <div className="grow overflow-auto relative" ref={scrollViewer} onMouseDown={onMouseDownScroll}>
                  {/* Indicateur de navigation instantanée */}
                  {isNavigatingInstantly && (
                    <div className="flex items-center justify-center py-4 text-blue-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                      <span className="text-sm">Navigation...</span>
                    </div>
                  )}
                  {itemsCount === 0 && !loading && (
                    <div className="mt-4 text-center border-2 border-dashed rounded-md p-8">
                      <Subtitle className="block mb-2">
                        {Languages.t('scenes.app.drive.nothing')}
                      </Subtitle>
                      {!inTrash && access != 'read' && (
                        <>
                          <Base>{Languages.t('scenes.app.drive.drag_and_drop')}</Base>
                          <br />
                          <Button
                            onClick={() => uploadItemModal()}
                            theme={isPreparingUpload ? 'outline' : 'primary'}
                            className="mt-4"
                            loading={isPreparingUpload}
                            disabled={isPreparingUpload}
                            testClassId="button-add-doc"
                          >
                            {Languages.t('scenes.app.drive.add_doc')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {viewMode === 'gallery' ? (
                    <GalleryView
                      items={visibleItems as any}
                      checked={checked}
                      onCheck={(id, v) => setChecked(_.pickBy({ ...checked, [id]: v }, _.identity))}
                      buildContextMenu={(it: any) => onBuildContextMenu(details, it)}
                      onOpenFolder={(id: string) => {
                        const route = RouterServices.generateRouteFromState({ dirId: id });
                        history.push(route);
                        if (inPublicSharing) return setParentId(id);
                      }}
                      onOpenFile={(id: string) => {
                        const it = children.find(c => c.id === id) || items.find(c => c.id === id);
                        if (it && !it.is_directory) {
                          openPreview(it);
                          history.push(RouterServices.generateRouteFromState({ companyId, itemId: id }));
                        }
                      }}
                      onContextMenu={(it: any, evt: React.MouseEvent) => {
                        evt.preventDefault();
                        onBuildContextMenu(details, it);
                      }}
                    />
                  ) : (
                    <>
                      {visibleItems.map((child, index) =>
                        child.is_directory ? (
                          <Droppable id={index} key={index}>
                            <FolderRow
                              key={index}
                              className={
                                (index === 0 ? 'rounded-t-md ' : '-mt-px ') +
                                (index === visibleItems.length - 1 ? 'rounded-b-md ' : '') +
                                'border-0 md:border'
                              }
                              item={child}
                              onClick={() => {
                                const route = RouterServices.generateRouteFromState({
                                  dirId: child.id,
                                });
                                history.push(route);
                                if (inPublicSharing) return setParentId(child.id);
                              }}
                              checked={checked[child.id] || false}
                              onCheck={v =>
                                setChecked(_.pickBy({ ...checked, [child.id]: v }, _.identity))
                              }
                              onBuildContextMenu={() => onBuildContextMenu(details, child)}
                            />
                          </Droppable>
                        ) : (
                          draggableMarkup(index, child)
                        ),
                      )}
                    </>
                  )}
                  {shouldVirtualize && visibleRange.end < itemsCount && (
                    <div className="flex justify-center py-4">
                      <Button
                        theme="secondary"
                        onClick={() =>
                          setVisibleRange((v: { start: number; end: number }) => ({ start: 0, end: Math.min(v.end + VIRT_PAGE_SIZE, itemsCount) }))
                        }
                      >
                        Charger plus ({visibleRange.end}/{itemsCount})
                      </Button>
                    </div>
                  )}
                  <DragOverlay>
                    {activeIndex ? (
                      <DocumentRowOverlay
                        className={
                          (activeIndex === 0 ? 'rounded-t-md ' : '-mt-px ') +
                          (activeIndex === items.length - 1 ? 'rounded-b-md ' : '')
                        }
                        item={activeChild}
                      ></DocumentRowOverlay>
                    ) : null}
                  </DragOverlay>
                  {selectRect && (
                    <div
                      style={{
                        position: 'fixed',
                        left: selectRect.left,
                        top: selectRect.top,
                        width: selectRect.width,
                        height: selectRect.height,
                        border: '1px dashed rgba(59,130,246,0.9)',
                        background: 'rgba(59,130,246,0.12)',
                        pointerEvents: 'none',
                        zIndex: 50,
                      }}
                    />
                  )}
                  {loading && <FolderRowSkeleton />}
                </div>
              </DndContext>
            </div>
          </UploadZone>
        )}
      </>
    );
  },
);
