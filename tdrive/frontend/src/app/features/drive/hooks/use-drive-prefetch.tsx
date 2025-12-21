import { useEffect, useRef } from 'react';
import { useRecoilCallback } from 'recoil';
import { DriveItemAtom, DriveItemChildrenAtom } from '../state/store';
import { useDriveActions } from './use-drive-actions';
import useRouterCompany from '@features/router/hooks/use-router-company';
import { useCurrentUser } from '@features/users/hooks/use-current-user';

/**
 * Hook pour précharger et mettre en cache les données des différentes sections du drive
 * Améliore la fluidité de navigation entre Mon drive, Drive partagé, Dropbox, etc.
 */
export const useDrivePrefetch = () => {
  const companyId = useRouterCompany();
  const { user } = useCurrentUser();
  const { refresh: refreshItem } = useDriveActions();
  const prefetchedRef = useRef<Set<string>>(new Set());
  const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cache avec TTL de 5 minutes
  const CACHE_TTL = 5 * 60 * 1000;
  const cacheTimestamps = useRef<Map<string, number>>(new Map());

  const isCacheValid = (key: string): boolean => {
    const timestamp = cacheTimestamps.current.get(key);
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_TTL;
  };

  const setCacheTimestamp = (key: string) => {
    cacheTimestamps.current.set(key, Date.now());
  };

  const prefetchSection = useRecoilCallback(
    ({ snapshot, set }) =>
      async (sectionId: string) => {
        // Éviter de précharger plusieurs fois la même section
        if (prefetchedRef.current.has(sectionId)) {
          console.log(`📦 Section ${sectionId} déjà en cache`);
          return;
        }

        // Vérifier si le cache est encore valide
        if (isCacheValid(sectionId)) {
          console.log(`✅ Cache valide pour ${sectionId}`);
          return;
        }

        try {
          console.log(`🔄 Préchargement de la section: ${sectionId}`);
          
          // Précharger les données sans afficher de loader
          await refreshItem(sectionId, true);
          
          // Marquer comme préchargé
          prefetchedRef.current.add(sectionId);
          setCacheTimestamp(sectionId);
          
          console.log(`✅ Section ${sectionId} préchargée avec succès`);
        } catch (error) {
          console.error(`❌ Erreur lors du préchargement de ${sectionId}:`, error);
        }
      },
    [refreshItem]
  );

  /**
   * Précharger les sections principales au démarrage
   */
  useEffect(() => {
    if (!user?.id || !companyId) return;

    // Attendre 2 secondes après le chargement initial avant de précharger
    prefetchTimeoutRef.current = setTimeout(() => {
      const sectionsToPreload = [
        `user_${user.id}`, // Mon drive
        'shared_with_me', // Drive partagé
        'trash', // Corbeille
      ];

      // Précharger chaque section avec un délai entre chaque
      sectionsToPreload.forEach((sectionId, index) => {
        setTimeout(() => {
          prefetchSection(sectionId);
        }, index * 500); // 500ms entre chaque préchargement
      });
    }, 2000);

    return () => {
      if (prefetchTimeoutRef.current) {
        clearTimeout(prefetchTimeoutRef.current);
      }
    };
  }, [user?.id, companyId, prefetchSection]);

  /**
   * Précharger une section spécifique (utilisable manuellement)
   */
  const prefetch = (sectionId: string) => {
    prefetchSection(sectionId);
  };

  /**
   * Invalider le cache d'une section
   */
  const invalidateCache = (sectionId: string) => {
    prefetchedRef.current.delete(sectionId);
    cacheTimestamps.current.delete(sectionId);
    console.log(`🗑️ Cache invalidé pour ${sectionId}`);
  };

  /**
   * Vider tout le cache
   */
  const clearAllCache = () => {
    prefetchedRef.current.clear();
    cacheTimestamps.current.clear();
    console.log('🗑️ Tout le cache a été vidé');
  };

  return {
    prefetch,
    invalidateCache,
    clearAllCache,
  };
};
