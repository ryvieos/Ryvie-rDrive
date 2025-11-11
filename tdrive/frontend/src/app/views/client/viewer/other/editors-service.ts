/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { useCompanyApplications } from '@features/applications/hooks/use-company-applications';
import { Application } from '@features/applications/types/application';
import jwtStorageService from '@features/auth/jwt-storage-service';
import useRouterCompany from '@features/router/hooks/use-router-company';
import useRouterWorkspace from '@features/router/hooks/use-router-workspace';
import environment from '@environment/environment';

type EditorType = {
  url?: string;
  is_url_file?: boolean;
  name?: string;
  app?: Application;
};

export const useEditors = (
  extension: string,
  options?: { preview_url?: string; editor_url?: string; editor_name?: string; url?: string },
) => {
  const workspaceId = useRouterWorkspace();
  const companyId = useRouterCompany();
  const { applications } = useCompanyApplications();
  
  const { preview_candidate, editor_candidate } = useMemo(() => {
    console.log('[useEditors] Recalcul des candidats - applications:', applications.length);
    
    const apps = applications.filter(
      app =>
        app.display?.tdrive?.files?.editor?.preview_url ||
        app.display?.tdrive?.files?.editor?.edition_url,
    );

    console.log('[useEditors] Apps filtrées pour OnlyOffice:', apps.length);

    const preview_candidate: EditorType[] = [];
    const editor_candidate: EditorType[] = [];

  if (options?.preview_url) {
    preview_candidate.push({
      url: options?.preview_url,
    });
  }
  if (options?.editor_url) {
    editor_candidate.push({
      is_url_file: true,
      url: options?.editor_url,
      name: options?.editor_name || 'web link',
    });
  }

    //Primary exts
    apps.forEach(app => {
      if (
        (app.display?.tdrive?.files?.editor?.extensions || []).indexOf(
          ((extension || '') + (options?.url ? '.url' : '')).toLocaleLowerCase(),
        ) >= 0
      ) {
        if (app.display?.tdrive?.files?.editor?.edition_url) {
          editor_candidate.push({ app });
        }
        if (app.display?.tdrive?.files?.editor?.preview_url) {
          preview_candidate.push({
            url: app.display?.tdrive?.files?.editor?.preview_url,
            app: app,
          });
        }
      }
    });

    console.log('[useEditors] preview_candidate:', preview_candidate.length, preview_candidate);
    console.log('[useEditors] editor_candidate:', editor_candidate.length);
    
    return { preview_candidate, editor_candidate };
  }, [applications, extension, options]);

  const openFile = (app: any, fileId: string, driveId: string) => {
    if (app.url && app.is_url_file) {
      window.open(app.url);
      return;
    }

    window.open(getFileUrl(app.display?.tdrive?.files?.editor?.edition_url, fileId, driveId));
  };

  const getPreviewUrl = (fileId: string): string => {
    const baseUrl = preview_candidate?.[0]?.url as string;
    console.log('[getPreviewUrl] fileId:', fileId, 'baseUrl:', baseUrl, 'preview_candidate:', preview_candidate.length);
    return getFileUrl(baseUrl, fileId);
  };

  const getFileUrl = (url: string, file_id: string, drive_id?: string): string => {
    const jwt = jwtStorageService.getJWT();
    
    // Base du connecteur: toujours issue de la config runtime (même origine en local via Caddy)
    // @ts-ignore
    const connectorUrl = (window.APP_CONFIG?.ONLYOFFICE_CONNECTOR_URL) || process.env.REACT_APP_ONLYOFFICE_CONNECTOR_URL || `${window.location.protocol}//${window.location.hostname}`;

    // Déterminer si c'est pour une prévisualisation ou pour l'édition
    const isPreview = !drive_id;

    // Construire systématiquement l'URL du connecteur pour éviter PNA et assurer la cohérence
    url = `${connectorUrl}/plugins/onlyoffice`;
    if (isPreview) {
      url += '?preview=1';
      console.log('[getFileUrl] URL de prévisualisation construite:', url);
    } else {
      console.log('[getFileUrl] URL d\'édition construite:', url);
    }

    return `${url}${
      url.indexOf('?') > 0 ? '&' : '?'
    }token=${jwt}&workspace_id=${workspaceId}&company_id=${companyId}&file_id=${file_id}${
      drive_id ? `&drive_file_id=${drive_id}` : ''
    }`;
  };

  return { candidates: editor_candidate, openFile, getPreviewUrl };
};
