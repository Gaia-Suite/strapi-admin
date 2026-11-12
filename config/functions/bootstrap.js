'use strict';

const { merge } = require('lodash/fp');
const { getService } = require('../../utils');
const adminActions = require('../admin-actions');
const adminConditions = require('../admin-conditions');

const defaultAdminAuthSettings = {
  providers: {
    autoRegister: false,
    defaultRole: null,
  },
};

const registerPermissionActions = () => {
  return getService('permission').actionProvider.registerMany(adminActions.actions);
};

const registerAdminConditions = () => {
  return getService('permission').conditionProvider.registerMany(adminConditions.conditions);
};

const syncAuthSettings = async () => {
  const adminStore = await strapi.store({ type: 'core', environment: '', name: 'admin' });
  const adminAuthSettings = await adminStore.get({ key: 'auth' });
  const newAuthSettings = merge(defaultAdminAuthSettings, adminAuthSettings);

  const roleExists = await strapi.admin.services.role.exists({
    id: newAuthSettings.providers.defaultRole,
  });

  // Reset the default SSO role if it has been deleted manually
  if (!roleExists) {
    newAuthSettings.providers.defaultRole = null;
  }

  await adminStore.set({ key: 'auth', value: newAuthSettings });
};

module.exports = async () => {
  // Awaited: the providers refuse registrations once Strapi is loaded, right after this function returns
  await registerAdminConditions();
  await registerPermissionActions();

  strapi.admin.destroy = async () => {
    const { conditionProvider, actionProvider } = getService('permission');

    await conditionProvider.clear();
    await actionProvider.clear();
  };

  // Only the cron instance syncs roles, permissions and auth settings to the DB: instances booting together
  // would delete and update the same permission rows, and the loser's bootstrap error stops its process.
  if (!strapi.config.get('server.cron.enabled')) {
    return;
  }

  const permissionService = getService('permission');
  const userService = getService('user');
  const roleService = getService('role');

  await userService.migrateUsers();

  await roleService.createRolesIfNoneExist();
  await roleService.resetSuperAdminPermissions();
  await roleService.displayWarningIfNoSuperAdmin();

  await permissionService.ensureBoundPermissionsInDatabase();
  await permissionService.cleanPermissionsInDatabase();

  await userService.displayWarningIfUsersDontHaveRole();

  await syncAuthSettings();
};
