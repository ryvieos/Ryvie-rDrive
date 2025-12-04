import { MenuIcon } from '@heroicons/react/outline';
import Account from '../common/account';
import Search from '../common/search';
import { Info } from "@atoms/text";
import version from '../../../environment/version';

export default ({ openSideMenu }: { openSideMenu: () => void }) => {
  return (
    <div
      className="bg-white dark:bg-zinc-900 h-16 sm:h-20 p-4 sm:p-6 flex space-between items-center testid:header"
      style={{
        paddingLeft: '1.875rem',
        paddingRight: '1.875rem',
      }}
    >
      <div className="sm:block hidden shrink-0 w-2/6 max-w-xs" style={{ minWidth: 100 }}>
        <div className="flex items-center gap-2">
          <img
            src="/public/img/logo/logo-color.svg"
            className="h-10 w-10"
            alt="rDrive"
          />
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-black dark:text-white">rDrive</span>
            <Info className="font-bold overflow-hidden text-ellipsis whitespace-nowrap w-full block -mt-1 testid:version">
              v{version.version}
            </Info>
          </div>
        </div>
      </div>
      <div
        onClick={() => openSideMenu()}
        className="sm:hidden block shrink-0 w-10 hover:text-zinc-600 text-zinc-500 cursor-pointer -mx-2 px-2 testid:button-open-side-menu"
      >
        <MenuIcon className="w-6 h-6" />
      </div>

      <div className="ml-4 mr-4 grow">
        <Search />
      </div>

      <div className="sm:block hidden grow"></div>
      <Account />
    </div>
  );
};
