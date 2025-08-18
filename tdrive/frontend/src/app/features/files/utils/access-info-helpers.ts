import {
  AuthEntity,
  DriveItemAccessInfo,
  DriveFileAccessLevel,
  DriveFileAccessLevelForInherited,
  DriveFileAccessLevelForPublicLink,
  DriveItem,
} from '@features/drive/types';
import Logger from '@features/global/framework/logger-service';

const getLogger = () => Logger.getLogger('access-info-helpers');

const entityMatcher = (entityType: AuthEntity['type'], entityId?: string) =>
  (entity: AuthEntity) =>
    entity && entity.type === entityType && (entityId == undefined || entity.id === entityId);

/** Updates the level of entities matching the given type and id, or adds the return
  * of updater with no argument.
  *
  * If an item is not unique, all are modified and a logger warning is printed except for `entityType` "channel".
  */
function upsertEntities(
  entities: AuthEntity[] | undefined,
  entityType: AuthEntity['type'],
  entityId: string | undefined,
  level: DriveFileAccessLevel,
) {
  const updater = (existing?: AuthEntity) => {
    if (!existing && !entityId) throw new Error("Cannot create entry without entityId");
    return {
      ...(existing || { type: entityType, id: entityId }),
      level,
    };
  };
  let found = false;
  if (!entities || entities.length == 0) return [updater()];
  const matcher = entityMatcher(entityType, entityId);
  const mapped = entities.map(item => {
    if (!matcher(item)) return item;
    if (found && entityType != "channel") getLogger().warn(`DriveItem has more than one access_info entry for '${entityType}' id = ${entityId}:`, item);
    found = true;
    return updater(item);
  }).filter(x => x);
  if (found) return mapped;
  return [...entities, updater()];
}

/** If `level == false`, deletes matching entries, otherwise calls `upsertEntities`
  */
function editEntities(
  entities: AuthEntity[] | undefined,
  entityType: AuthEntity['type'],
  entityId: string | undefined,
  level: DriveFileAccessLevel | false,
) {
  if (level) return upsertEntities(entities, entityType, entityId, level);
  const matcher = entityMatcher(entityType, entityId);
  return entities && entities.filter(item => !matcher(item));
}

/** Return a list of all DriveItemAccessInfo for entities with the provided type sorted by id */
const accessInfosOfEntitiesOfType = (item: DriveItem | undefined, entityType: AuthEntity['type']) =>
  item?.access_info.entities.filter(entityMatcher(entityType)).sort((a, b) => a.id.localeCompare(b.id)) || [];

/** Find access level for the given entity in the DriveItem's access_info and return it's level if any, or undefined */
export function accessLevelOfEntityForItem(
  item: DriveItem | undefined,
  entityType: AuthEntity['type'],
  entityId: string,
) {
  const matcher = entityMatcher(entityType, entityId);
  return item?.access_info.entities.filter(matcher)[0]?.level;
}

/** Return the item with the access right for the given entity added or changed to level; or if its false, remove if any */
const itemWithEntityAccessChanged = (
  item: DriveItem,
  entityType: AuthEntity['type'],
  entityId: string | undefined,
  level: DriveFileAccessLevel | false,
) => ({
    ...item,
    access_info: {
      ...item.access_info,
      entities: editEntities(item.access_info.entities, entityType, entityId, level),
    },
  } as DriveItem);

// Note this just assumes uniqueness and just logs if that is not the case and uses the first one.
const getAccessLevelOfUniqueForType = (item: DriveItem | undefined, entityType: AuthEntity['type'], entityId?: string) => {
  if (!item) return undefined;
  const accesses = item.access_info.entities.filter(entityMatcher(entityType, entityId));
  if (accesses.length != 1 && entityType != "channel")
    getLogger().warn(`DriveItem doesn't have exactly one access_info entry for '${entityType}${entityId ? " id: " + entityId : ""}':`, item);
  return accesses[0]?.level;
}

/** Return a shallow copy of item with the access right for the given user added or changed to level; or if its false, removed */
export const changeUserAccess = (item: DriveItem, userId: string, level: DriveFileAccessLevel | false) =>
  itemWithEntityAccessChanged(item, "user", userId, level);

/** Return a list of all DriveItemAccessInfo for users sorted by id */
export const getAllUserAccesses = (item: DriveItem) => accessInfosOfEntitiesOfType(item, "user");

/** Return the access level for the provided user; an entry is expected to exist (or there is a `logger.warn`) */
export const getUserAccessLevel = (item: DriveItem, userId: string) => getAccessLevelOfUniqueForType(item, "user", userId);



/** Return current access level inherited from parent folder by item */
export const getInheritedAccessLevel = (item?: DriveItem) => getAccessLevelOfUniqueForType(item, "folder");

/** Return a shallow copy of item with the access right for the given entity added or changed to level; or if its false, removed */
export const changeInheritedAccess = (item: DriveItem, level: DriveFileAccessLevelForInherited | false) =>
  itemWithEntityAccessChanged(item, "folder", "parent", level);



/** Return access level for the company type entity if any */
export const getCompanyAccessLevel = (item?: DriveItem) => getAccessLevelOfUniqueForType(item, "company");

/** Return a shallow copy of item with the access right for the given entity changed to level; or if its false, removed.
 * Removing is irreversible. Calling this method setting a level on a `DriveItem` that doesn't have a company entry will
 * throw an Error.
 */
export const changeCompanyAccessLevel = (item: DriveItem, level: DriveFileAccessLevel | false) =>
  itemWithEntityAccessChanged(item, "company", undefined, level);



/** Return the first, if any, access level of a channel */
export const getFirstChannelAccessLevel = (item?: DriveItem) => getAccessLevelOfUniqueForType(item, "channel");

/** Return a shallow copy of item with the access right for the given entity changed to level; or if its false, removed.
 * Removing is irreversible. Calling this method setting a level on a `DriveItem` that doesn't have a channel entry will
 * throw an Error.
 */
export const changeAllChannelAccessLevels = (item: DriveItem, level: DriveFileAccessLevel | false) =>
  itemWithEntityAccessChanged(item, "channel", undefined, level);



/** Return a shallow copy of item with the public link properties for the given entity changed
 *
 * - level defaults to 'none' if not set and this is called without a value in `changes` for it
 * - sets all fields in `changes` argument as they are, even if their value is null, undefined, false etc
 * - runtime does not validate that fields in `changes` argument are properly typed or correctly named
 */
export function changePublicLink(
  item: DriveItem,
  changes: {
    level?: DriveFileAccessLevelForPublicLink,
    expiration?: number,
    password?: string,
  },
) {
  const publicSettings : DriveItemAccessInfo["public"] = item.access_info.public ? { ...item.access_info.public } : { token: '', level: "none" };
  Object.entries(changes).forEach(([field, value]) => (publicSettings as { [k: string]: unknown })[field] = value);
  return {
    ...item,
    access_info: {
      ...item.access_info,
      public: publicSettings,
    },
  } as DriveItem;
}

/** Return the access level of the public link if it's set, and it isn't `"none"`, or returns false */
export const hasAnyPublicLinkAccess = (item?: Partial<DriveItem>) : Exclude<DriveFileAccessLevel, "none"> | false =>
  (item?.access_info?.public?.level && item.access_info.public.level != "none") ? item.access_info.public.level : false;

/** Return the access level of the shared drive if it's set, and it isn't `"none"`, or returns false */
export const hasSharedDriveAccess = (item?: Partial<DriveItem>) : Exclude<DriveFileAccessLevel, "none"> | false => {
  // Only check if the item itself is directly shared in Shared Drive
  const sharedDriveEntity = item?.access_info?.entities?.find(
    entity => entity.type === "folder" && entity.id === "shared_drive"
  );
  return (sharedDriveEntity?.level && sharedDriveEntity.level !== "none") ? sharedDriveEntity.level : false;
};