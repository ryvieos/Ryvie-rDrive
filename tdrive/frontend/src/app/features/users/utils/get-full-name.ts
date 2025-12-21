import Languages from '@features/global/services/languages-service';
import { UserType } from '@features/users/types/user';

export function getFullName(user: Pick<UserType, 'username' | 'first_name' | 'last_name' | 'deleted'>): string {
  let name: string = user?.username;

  if (!name) {
    return Languages.t('general.user.anonymous');
  }
  // @author https://stackoverflow.com/a/17200679
  const toNameCase = (str?: string) => (str || '').toLowerCase().replace(/(?<!\p{L})\p{L}(?=\p{L}{2})/gu, (m: string) => m.toUpperCase());

  if (user.deleted) {
    name = Languages.t('general.user.deleted');
  } else {
    name = [user.first_name, user.last_name].filter(a => a != null && a !== '').map(toNameCase).join(' ');
    name = name || user.username;
  }

  return name;
}