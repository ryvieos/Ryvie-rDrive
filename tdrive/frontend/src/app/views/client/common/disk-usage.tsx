import { CloudIcon } from "@heroicons/react/outline";
import { formatBytesToInt } from "@features/drive/utils";
import Languages from "features/global/services/languages-service";
import { useUserQuota } from "@features/users/hooks/use-user-quota";
import RouterServices from "features/router/services/router-service";
import { useEffect, useState } from "react";
import FeatureTogglesService, { FeatureNames } from "@features/global/services/feature-toggles-service";
import { useDriveItem } from "features/drive/hooks/use-drive-item";
import { useCurrentUser } from "@features/users/hooks/use-current-user";


const DiskUsage = () => {
  const { user } = useCurrentUser();
  const myDriveId = user?.id ? `user_${user.id}` : "root";

  const [used, setUsed] = useState(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  const { quota, getQuota } = useUserQuota();

  useEffect(() => {
    getQuota();
  }, [])

  useEffect(() => {
    if (FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_USER_QUOTA)) {
      setUsed(Math.round(quota.used / quota.total * 100))
      setUsedBytes(quota.used);
      setTotalBytes(quota.total);
    }
  }, [quota]);

  const { item } = useDriveItem(myDriveId);
  useEffect(() => {
    if (!FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_USER_QUOTA)) {
      setUsedBytes(item?.size || 0);
    }
  }, [myDriveId, item])

  return (
    <>
      {FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_USER_QUOTA) && (
        <div className="bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg">
              <CloudIcon className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                Stockage
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                {formatBytesToInt(totalBytes - usedBytes)}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                disponible
              </span>
            </div>
            
            <div className="relative h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div 
                style={{ width: `${used}%` }}
                className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                  used > 90 
                    ? 'bg-gradient-to-r from-red-500 to-red-600' 
                    : used >= 80 
                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500' 
                    : 'bg-gradient-to-r from-blue-500 to-blue-600'
                }`}
                data-testid={
                  used > 90 
                    ? 'disk-usage-over-90' 
                    : used >= 80 
                    ? 'disk-usage-80-to-90' 
                    : 'disk-usage-less-than-80'
                }
              />
            </div>
            
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-600 dark:text-zinc-400 testid:disk-usage-text">
                {formatBytesToInt(usedBytes)} utilisé
              </span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {used}%
              </span>
            </div>
          </div>
        </div>
      )}
      {!FeatureTogglesService.isActiveFeatureName(FeatureNames.COMPANY_USER_QUOTA) && (
        <div className="bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg">
              <CloudIcon className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                Stockage
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-zinc-900 dark:text-white testid:disk-usage-text">
                {formatBytesToInt(usedBytes)}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                utilisé
              </span>
            </div>
            
            <div className="relative h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div 
                style={{ width: '100%' }}
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 bg-gradient-to-r from-blue-500 to-blue-600"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DiskUsage;