#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import { TdrivePlatform, TdrivePlatformConfiguration } from '../core/platform/platform';
import globalResolver from '../services/global-resolver';
import config from '../core/config';
import User from '../services/user/entities/user';
import Workspace from '../services/workspaces/entities/workspace';

interface LDAPUser {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface LDAPConfig {
  url: string;
  bindDN: string;
  bindPassword: string;
  baseDN: string;
  usersDN: string;
}

async function getAllLDAPUsers(): Promise<LDAPUser[]> {
  try {
    const ldapConfig: LDAPConfig = {
      url: process.env.LDAP_URL || 'ldap://localhost:389',
      bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=example,dc=org',
      bindPassword: process.env.LDAP_BIND_PASSWORD || 'adminpassword',
      baseDN: process.env.LDAP_BASE_DN || 'dc=example,dc=org',
      usersDN: process.env.LDAP_USERS_DN || 'ou=users,dc=example,dc=org',
    };

    const command = `ldapsearch -x -H "${ldapConfig.url}" -D "${ldapConfig.bindDN}" -w "${ldapConfig.bindPassword}" -b "${ldapConfig.usersDN}" "(objectClass=person)" cn mail givenName sn`;
    
    console.log('🔍 Searching for LDAP users...');
    const output = execSync(command, { encoding: 'utf8' });
    
    const users: LDAPUser[] = [];
    const entries = output.split('\n\n');
    
    for (const entry of entries) {
      if (entry.includes('dn:') && entry.includes('mail:')) {
        const lines = entry.split('\n');
        const user: Partial<LDAPUser> = {};
        
        for (const line of lines) {
          if (line.startsWith('cn: ')) {
            user.username = line.substring(4).trim();
          } else if (line.startsWith('mail: ')) {
            user.email = line.substring(6).trim();
          } else if (line.startsWith('givenName: ')) {
            user.firstName = line.substring(11).trim();
          } else if (line.startsWith('sn: ')) {
            user.lastName = line.substring(4).trim();
          }
        }
        
        if (user.email && user.username) {
          users.push(user as LDAPUser);
        }
      }
    }
    
    console.log(`✅ Found ${users.length} LDAP users`);
    return users;
    
  } catch (error: any) {
    console.error('❌ Error fetching LDAP users:', error.message);
    return [];
  }
}

async function initializeTdrive(): Promise<void> {
  try {
    const configuration: TdrivePlatformConfiguration = {
      services: config.get("services"),
      servicesPath: path.resolve(__dirname, "../services/"),
    };
    const platform = new TdrivePlatform(configuration);
    await platform.init();
    // Ne pas démarrer le serveur web pour éviter le conflit de port
    // await platform.start();
    await globalResolver.doInit(platform);
  } catch (err) {
    console.error("Failed to initialize Tdrive platform: ", err);
    process.exit(-1);
  }
}

async function syncLDAPUsersToTdrive(): Promise<void> {
  try {
    console.log('🚀 Starting LDAP to Tdrive user synchronization...');
    
    // Initialize the application
    await initializeTdrive();
    const gr = globalResolver;
    
    // Get all LDAP users
    const ldapUsers = await getAllLDAPUsers();
    
    if (ldapUsers.length === 0) {
      console.log('⚠️  No LDAP users found to synchronize');
      return;
    }
    
    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const ldapUser of ldapUsers) {
      try {
        console.log(`\n📝 Processing user: ${ldapUser.email}`);
        
        // Check if user already exists in Tdrive
        const existingUser = await gr.services.users.getByEmail(ldapUser.email);
        
        if (existingUser) {
          console.log(`   ✅ User ${ldapUser.email} already exists in Tdrive`);
          
          // Get the first company (same logic as signup method)
          const companies = await gr.services.companies.getCompanies();
          const company = companies.getEntities()?.[0];
          if (!company) {
            console.error('❌ No company found - cannot sync existing LDAP user');
            continue;
          }
          
          // Update user information if needed
          let needsUpdate = false;
          
          if (existingUser.first_name !== ldapUser.firstName) {
            existingUser.first_name = ldapUser.firstName;
            needsUpdate = true;
          }
          if (existingUser.last_name !== ldapUser.lastName) {
            existingUser.last_name = ldapUser.lastName;
            needsUpdate = true;
          }
          
          // Ensure LDAP user has correct cache.companies
          if (!existingUser.cache?.companies?.includes(company.id)) {
            existingUser.cache = {
              ...existingUser.cache,
              companies: [company.id]
            };
            needsUpdate = true;
          }
          
          // Ensure LDAP user has preferences with recent_workspaces
          if (!existingUser.preferences?.recent_workspaces) {
            existingUser.preferences = {
              ...existingUser.preferences,
              recent_workspaces: []
            };
            needsUpdate = true;
          }
          
          if (needsUpdate) {
            const context = { user: { id: 'system' } };
            await gr.services.users.save(existingUser, context);
            console.log(`   🔄 Updated user basic info for ${ldapUser.email}`);
          }
          
          // Ensure user is associated with company (crucial for role and visibility)
          await gr.services.companies.setUserRole(company.id, existingUser.id, 'member');
          console.log(`   🏢 Ensured company association for ${ldapUser.email}`);
          
          // Process pending workspace invitations
          await gr.services.workspaces.processPendingUser(existingUser);
          
          // Ensure user has workspace association
          const userWorkspaces = await gr.services.workspaces.getAllForUser(
            { userId: existingUser.id },
            { id: company.id }
          );
          
          if (userWorkspaces.length === 0) {
            const createdWorkspace = await gr.services.workspaces.create(
              {
                company_id: company.id,
                name: `${existingUser.first_name || existingUser.last_name || existingUser.username_canonical}'s space`,
              } as Workspace,
              { user: { id: existingUser.id } }
            );
            console.log(`   🏢 Created workspace for existing user ${ldapUser.email}`);
            
            // Update recent_workspaces
            existingUser.preferences = {
              ...existingUser.preferences,
              recent_workspaces: [{ 
                company_id: company.id, 
                workspace_id: createdWorkspace.entity.id 
              }]
            };
          } else {
            console.log(`   🏢 User ${ldapUser.email} already has ${userWorkspaces.length} workspace(s)`);
            
            // Update recent_workspaces with existing workspace
            existingUser.preferences = {
              ...existingUser.preferences,
              recent_workspaces: [{ 
                company_id: company.id, 
                workspace_id: userWorkspaces[0].id 
              }]
            };
          }
          
          // Save final user state with recent_workspaces
          const context = { user: { id: 'system' } };
          await gr.services.users.save(existingUser, context);
          console.log(`   🔗 Updated recent_workspaces for ${ldapUser.email}`);
          
          updatedCount++;
          
        } else {
          console.log(`   🆕 Creating new user: ${ldapUser.email}`);
          
          // Create new user entity in Tdrive
          const newUser = new User();
          newUser.email_canonical = ldapUser.email.toLowerCase();
          newUser.username_canonical = ldapUser.username.toLowerCase();
          newUser.first_name = ldapUser.firstName || '';
          newUser.last_name = ldapUser.lastName || '';
          newUser.password = ''; // No password for LDAP users
          newUser.mail_verified = true;
          newUser.status_icon = '';
          newUser.last_activity = new Date().getTime();
          newUser.creation_date = new Date().getTime();
          newUser.deleted = false;
          // Get the first company (same logic as signup method)
          const companies = await globalResolver.services.companies.getCompanies();
          const company = companies.getEntities()?.[0];
          if (!company) {
            console.error('❌ No company found - cannot sync LDAP user');
            continue;
          }
          
          // Add companies field for LDAP users via cache (must be object)
          newUser.cache = {
            companies: [company.id]
          };
          
          // Initialize preferences with recent_workspaces (crucial for frontend company_id context)
          newUser.preferences = {
            recent_workspaces: []
          };
          
          // Create execution context (required by Tdrive API)
          const context = { user: { id: 'system' } };
          
          const saveResult = await gr.services.users.save(newUser, context);
          console.log(`   ✅ Created user ${ldapUser.email}`);
          
          // Associate user with company (same logic as signup method)
          await gr.services.companies.setUserRole(company.id, saveResult.entity.id, 'member');
          
          // Process pending workspace invitations (same logic as signup method)
          await gr.services.workspaces.processPendingUser(saveResult.entity);
          
          // If user is in no workspace, get or create one (same logic as signup method)
          const userWorkspaces = await gr.services.workspaces.getAllForUser(
            { userId: saveResult.entity.id },
            { id: company.id }
          );
          if (userWorkspaces.length === 0) {
            const createdWorkspace = await gr.services.workspaces.create(
              {
                company_id: company.id,
                name: `${newUser.first_name || newUser.last_name || newUser.username_canonical}'s space`,
              } as Workspace,
              { user: { id: saveResult.entity.id } }
            );
            console.log(`   🏢 Created workspace for user ${ldapUser.email}`);
            
            // Update user's recent_workspaces to include the new workspace (crucial for frontend)
            saveResult.entity.preferences = {
              ...saveResult.entity.preferences,
              recent_workspaces: [{ 
                company_id: company.id, 
                workspace_id: createdWorkspace.entity.id 
              }]
            };
            await gr.services.users.save(saveResult.entity, context);
            console.log(`   🔗 Updated user's recent_workspaces for frontend context`);
          } else {
            console.log(`   🏢 User ${ldapUser.email} already has ${userWorkspaces.length} workspace(s)`);
            
            // Update user's recent_workspaces with existing workspace (crucial for frontend)
            saveResult.entity.preferences = {
              ...saveResult.entity.preferences,
              recent_workspaces: [{ 
                company_id: company.id, 
                workspace_id: userWorkspaces[0].id 
              }]
            };
            await gr.services.users.save(saveResult.entity, context);
            console.log(`   🔗 Updated user's recent_workspaces for frontend context`);
          }
          
          createdCount++;
          
          // Note: LDAP integration service is not available in global resolver
          // LDAP sync will happen automatically during login authentication
          console.log(`   🔗 User will be synced with LDAP on first login`);
          
        }
        
      } catch (userError: any) {
        console.error(`   ❌ Error processing user ${ldapUser.email}:`, userError.message);
        errorCount++;
      }
    }
    
    console.log('\n📊 Synchronization Summary:');
    console.log(`   🆕 Created: ${createdCount} users`);
    console.log(`   🔄 Updated: ${updatedCount} users`);
    console.log(`   ❌ Errors: ${errorCount} users`);
    console.log('✅ LDAP synchronization completed!');
    
  } catch (error: any) {
    console.error('❌ Fatal error during synchronization:', error);
    process.exit(1);
  }
}

// Run the synchronization
syncLDAPUsersToTdrive()
  .then(() => {
    console.log('🎉 Synchronization finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Synchronization failed:', error);
    process.exit(1);
  });
