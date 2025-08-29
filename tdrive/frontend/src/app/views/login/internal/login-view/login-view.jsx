import React, { Component } from 'react';

import Languages from '@features/global/services/languages-service';
import LoginService from '@features/auth/login-service';
import Emojione from 'components/emojione/emojione';
import Button from 'components/buttons/button.jsx';
import Input from 'components/inputs/input.jsx';
import InitService from '@features/global/services/init-service';
import { Typography } from 'antd';
export default class LoginView extends Component {
  constructor() {
    super();

    this.state = {
      login: LoginService,
      i18n: Languages,
    };

    LoginService.addListener(this);
    Languages.addListener(this);
  }
  componentWillUnmount() {
    LoginService.removeListener(this);
    Languages.removeListener(this);
  }
  render() {
    if (
      InitService.server_infos?.configuration?.accounts?.type !== 'internal' &&
      !(LoginService.external_login_error || false)
    ) {
      return <></>;
    }

    return (
      <div className="center_box_container login_view fade_in">
        <div className="center_box white_box_with_shadow">
          {/* Branding block: logo + title */}
          <div className="brand-block">
            <img
              className="brand-logo"
              alt={((InitService.server_infos || {}).branding || {}).name || 'rDrive'}
              src={
                ((InitService.server_infos || {}).branding || {}).logo || '/public/img/logo/logo-color.svg'
              }
            />
            <div className="brand-title">
              {this.state.i18n.t('scenes.login.home.title')}
            </div>
          </div>

          {this.state.login.external_login_error && (
            <div id="identification_information" className="error-banner" role="alert">
              <span className="error-banner__title">
                {this.state.i18n.t('scenes.login.home.unable_to_connect')}
              </span>
              <span className="error-banner__detail">
                {this.state.login.external_login_error}
              </span>
            </div>
          )}

          {(Object.keys((InitService.server_infos || {}).auth || []).indexOf('internal') >= 0 ||
            ((InitService.server_infos || {}).auth || []).length === 0) && (
            <div className="internal-login" aria-busy={this.state.login.login_loading}>
              <Input
                id="username"
                type="text"
                className={'bottom-margin medium full_width modern-input ' + (this.state.login.login_error ? 'error ' : '')}
                placeholder={this.state.i18n.t('scenes.login.home.email')}
                disabled={this.state.login.login_loading}
                onKeyDown={e => {
                  if (e.keyCode === 13 && !this.state.login.login_loading) {
                    LoginService.login({
                      username: this.state.form_login,
                      password: this.state.form_password,
                      remember_me: true,
                    });
                  }
                }}
                onChange={evt => this.setState({ form_login: evt.target.value })}
                testClassId="login-input-username"
              />

              <Input
                id="password"
                type="password"
                className={'bottom-margin medium full_width modern-input ' + (this.state.login.login_error ? 'error ' : '')}
                placeholder={this.state.i18n.t('scenes.login.home.password')}
                disabled={this.state.login.login_loading}
                onKeyDown={e => {
                  if (e.keyCode === 13 && !this.state.login.login_loading) {
                    LoginService.login({
                      username: this.state.form_login,
                      password: this.state.form_password,
                      remember_me: true,
                    });
                  }
                }}
                onChange={evt => this.setState({ form_password: evt.target.value })}
                testClassId="login-input-password"
              />

              {this.state.login.login_error && (
                <div id="identification_information" className="smalltext error">
                  {this.state.i18n.t('scenes.login.home.unable_to_connect')}
                </div>
              )}

              <Button
                id="login_btn"
                type="button"
                className="medium full_width modern-primary-btn"
                style={{ marginBottom: 12 }}
                disabled={this.state.login.login_loading}
                onClick={() =>
                  LoginService.login({
                    username: this.state.form_login,
                    password: this.state.form_password,
                    remember_me: true,
                  })
                }
                testClassId="login-button-submit"
              >
                {this.state.login.login_loading ? (
                  <span className="modern-spinner" aria-hidden="true" />
                ) : (
                  this.state.i18n.t('scenes.login.home.login_btn')
                )}
              </Button>
              {/* Sign-up entry removed per product requirement */}
            </div>
          )}
        </div>
      </div>
    );
  }
}
