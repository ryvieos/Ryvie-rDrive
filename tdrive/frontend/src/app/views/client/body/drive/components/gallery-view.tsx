import React, { memo, useState } from 'react';
import { CheckCircleIcon } from '@heroicons/react/solid';
import { DotsHorizontalIcon, CloudIcon } from '@heroicons/react/outline';
import { VideoCameraIcon, PhotographIcon } from '@heroicons/react/solid';
import { DocumentIcon } from '../documents/document-icon';
import { PublicIcon } from './public-icon';
import { hasAnyPublicLinkAccess, hasSharedDriveAccess } from '@features/files/utils/access-info-helpers';
import { formatBytes } from '@features/drive/utils';
import type { DriveItem } from 'app/features/drive/types';
import Menu from '@components/menus/menu';
import { Button } from '@atoms/button/button';
import fileUploadApiClient from '@features/files/api/file-upload-api-client';

const GalleryThumbnail: React.FC<{ item: DriveItem }> = ({ item }) => {
  const isDir = (item as any).is_directory;
  const meta = (item as any)?.last_version_cache?.file_metadata as any;
  const name = (item as any)?.name || '';
  const isImage = !!meta?.mime && meta.mime.startsWith('image/');
  const isVideo = !!meta?.mime && meta.mime.startsWith('video/');
  const likelyImageByExt = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(name);
  const likelyVideoByExt = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(name);

  const thumb = meta?.thumbnails?.[0];
  let initialThumbUrl: string | undefined = thumb?.full_url || thumb?.url;
  if (!initialThumbUrl && meta?.source === 'internal' && typeof meta?.external_id === 'string' && typeof thumb?.index !== 'undefined') {
    const base = fileUploadApiClient.getRoute({ companyId: (item as any).company_id, fileId: meta.external_id, fullApiRouteUrl: true });
    initialThumbUrl = `${base}/thumbnails/${thumb.index}`;
  }
  if (
    !initialThumbUrl &&
    !isDir &&
    (isImage || likelyImageByExt) &&
    meta?.source === 'internal' &&
    typeof meta?.external_id === 'string'
  ) {
    initialThumbUrl = fileUploadApiClient.getDownloadRoute({ companyId: (item as any).company_id, fileId: meta.external_id });
  }

  const [errored, setErrored] = useState(false);
  const thumbUrl = !errored ? initialThumbUrl : undefined;
  const looksLikeImage = !isDir && (isImage || likelyImageByExt);
  const [isLoading, setIsLoading] = useState(true);

  // If we don't have any preview URL for an image-like file (e.g., Dropbox/Google Drive without thumbnails),
  // show a short skeleton, then display a violet photo icon.
  React.useEffect(() => {
    // Reset loading state when item changes
    setIsLoading(true);
  }, [(item as any)?.id]);

  return (
    <div className="aspect-square w-full overflow-hidden rounded-t-lg bg-zinc-50 flex items-center justify-center">
      {(() => {
        if (!isDir && (isVideo || likelyVideoByExt)) {
          return (
            <div className="h-full w-full bg-yellow-50 flex items-center justify-center">
              <VideoCameraIcon className="h-16 w-16 text-yellow-600" />
            </div>
          );
        }

        if (looksLikeImage && thumbUrl) {
          return (
            <div className="relative h-full w-full">
              {isLoading && (
                <div className="absolute inset-0 bg-zinc-100 animate-pulse flex items-center justify-center">
                  <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              <img
                src={thumbUrl}
                alt={item.name}
                className={`h-full w-full object-cover ${isLoading ? 'opacity-0' : 'opacity-100 transition-opacity duration-200'}`}
                loading="lazy"
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setErrored(true);
                  setIsLoading(false);
                }}
              />
            </div>
          );
        }

        if (looksLikeImage && !thumbUrl) {
          return (
            <div className="h-full w-full bg-blue-50 flex items-center justify-center">
              {isLoading ? (
                <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <PhotographIcon className="h-16 w-16 text-blue-600" />
              )}
            </div>
          );
        }

        return <DocumentIcon item={item as any} className="h-16 w-16" />;
      })()}
    </div>
  );
};

export interface GalleryViewProps {
  items: DriveItem[];
  checked: Record<string, boolean>;
  onCheck: (id: string, value: boolean) => void;
  onOpenFolder: (id: string) => void;
  onOpenFile?: (id: string) => void;
  onContextMenu?: (item: DriveItem, evt: React.MouseEvent) => void;
  buildContextMenu?: (item: DriveItem) => any;
}

const clamp = (str: string, n = 48) => (str.length > n ? str.slice(0, n - 1) + '…' : str);

export const GalleryView: React.FC<GalleryViewProps> = memo(
  ({ items, checked, onCheck, onOpenFolder, onOpenFile, onContextMenu, buildContextMenu }) => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    return (
      <div className="p-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {items.map(item => {
            const isChecked = !!checked[item.id];
            const isDir = item.is_directory;
            return (
              <div
                key={item.id}
                id={`DR-${item.id}`}
                className={`group drive-grid-item relative rounded-lg border border-zinc-200 hover:border-blue-300 bg-white hover:shadow-sm transition ring-1 ring-transparent ${isChecked ? 'ring-blue-400 ring-2' : ''}`}
                onClick={() => (isDir ? onOpenFolder(item.id) : onOpenFile && onOpenFile(item.id))}
                onContextMenu={evt => onContextMenu && onContextMenu(item, evt)}
              >
                {/* Checkbox overlay */}
                <button
                  className="absolute top-2 left-2 z-10 rounded-full bg-white/80 p-0.5 shadow hover:bg-white"
                  onClick={e => {
                    e.stopPropagation();
                    onCheck(item.id, !isChecked);
                  }}
                  aria-label={isChecked ? 'Unselect' : 'Select'}
                >
                  <CheckCircleIcon className={`h-5 w-5 ${isChecked ? 'text-blue-600' : 'text-zinc-300 group-hover:text-zinc-400'}`} />
                </button>

                {/* Per-item menu (three dots) */}
                {buildContextMenu && (
                  <div className="absolute top-2 right-2 z-10" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                    <Menu menu={() => buildContextMenu(item)} enableMobileMenu={isMobile} testClassId="gallery-item-menu">
                      <Button
                        theme={'secondary'}
                        size="sm"
                        className={'!rounded-full !text-gray-500 md:!text-blue-500 bg-transparent md:bg-blue-500 md:bg-opacity-25 '}
                        icon={DotsHorizontalIcon}
                        testClassId="gallery-item-button-open-menu"
                      />
                    </Menu>
                  </div>
                )}

                {/* Preview area */}
                <GalleryThumbnail item={item as any} />

                {/* Meta */}
                <div className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 grow text-xs leading-4">
                      <div className="font-medium text-zinc-800 break-words" title={item.name}>
                        {clamp(item.name, 40)}
                      </div>
                      {!isDir && (
                        <div className="text-[11px] text-zinc-500">{formatBytes(item.size || 0)}</div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {hasSharedDriveAccess(item as any) && (
                        <span title="Shared">
                          <CloudIcon className="h-5 w-5 text-blue-500" />
                        </span>
                      )}
                      {hasAnyPublicLinkAccess(item as any) && (
                        <PublicIcon className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

export default GalleryView;
