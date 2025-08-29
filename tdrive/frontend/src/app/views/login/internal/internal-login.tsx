import React, { useEffect } from 'react';
import { Typography } from 'antd';

import Globals from '@features/global/services/globals-tdrive-app-service';
import Languages from '@features/global/services/languages-service';
import InitService from '@features/global/services/init-service';
import LoginService from '@features/auth/login-service';
import Icon from '@components/icon/icon.jsx';

import LoginView from './login-view/login-view';
import Error from './error';

import './login.scss';

export default () => {
  LoginService.useListener();
  Languages.useListener();
  const [server_infos_loaded, server_infos] = InitService.useWatcher(() => [
    InitService.server_infos_loaded,
    InitService.server_infos,
  ]);

  useEffect(() => {
    LoginService.init();
    document.body.classList.remove('fade_out');
    document.body.classList.add('fade_in');
    return () => {
      document.body.classList.remove('fade_in');
    };
  }, []);

  if (!server_infos_loaded) {
    return <div />;
  }

  return (
    <div className="loginPage">
      {/* Top-left legacy logo removed to avoid duplication; logo now inside the card */}

      {LoginService.state === 'error' && <Error />}
      {LoginService.state === 'logged_out' && <LoginView />}
      {/* Account creation disabled: hide Signin view */}

      {/* Footer branding/version removed per request */}

      <div className={'help_footer'}>
        {server_infos_loaded && server_infos?.configuration?.help_url && (
          <Typography.Link
            onClick={() =>
              window.open(InitService.server_infos?.configuration?.help_url || '', 'blank')
            }
            className="blue_link fade_in"
          >
            <Icon type="question-circle" /> {Languages.t('general.help')}
          </Typography.Link>
        )}
      </div>
    </div>
  );
};
