#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import * as fs from 'fs';
import { TdrivePlatform, TdrivePlatformConfiguration } from '../core/platform/platform';
import globalResolver from '../services/global-resolver';
import config from '../core/config';
import User from '../services/user/entities/user';
import Workspace from '../services/workspaces/entities/workspace';
import Company from '../services/user/entities/company';
import { getInstance as getCompanyInstance } from '../services/user/entities/company';
import { spawn } from 'child_process';

interface LDAPUser {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  uid: string;  // LDAP uid - unique identifier
  dn?: string;  // LDAP DN for reference
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
    const password = process.env.LDAP_BIND_PASSWORD;
    
    if (!password) {
      console.error('❌ CRITICAL: LDAP_BIND_PASSWORD environment variable is not set!');
      console.error('Please set LDAP_BIND_PASSWORD in your .env file or docker-compose.yml');
      throw new Error('LDAP_BIND_PASSWORD is required but not set');
    }
    
    if (password === 'adminpassword') {
      console.warn('⚠️  WARNING: LDAP_BIND_PASSWORD is using the default value "adminpassword"');
      console.warn('This is likely incorrect. Please verify your LDAP configuration.');
    }
    
    const ldapConfig: LDAPConfig = {
      url: process.env.LDAP_URL || 'ldap://localhost:389',
      bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=example,dc=org',
      bindPassword: password,
      baseDN: process.env.LDAP_BASE_DN || 'dc=example,dc=org',
      usersDN: process.env.LDAP_USERS_DN || 'ou=users,dc=example,dc=org',
    };

    const command = `ldapsearch -x -H "${ldapConfig.url}" -D "${ldapConfig.bindDN}" -w "${ldapConfig.bindPassword}" -b "${ldapConfig.usersDN}" "(objectClass=person)" cn mail givenName sn uid dn`;
    const output = execSync(command, { encoding: 'utf8' });
    
    const users: LDAPUser[] = [];
    const entries = output.split('\n\n');
    
    for (const entry of entries) {
      if (entry.includes('dn:') && entry.includes('mail:')) {
        const lines = entry.split('\n');
        const user: Partial<LDAPUser> = {};
        
        for (const line of lines) {
          if (line.startsWith('dn: ')) {
            user.dn = line.substring(4).trim();
          } else if (line.startsWith('cn: ')) {
            user.username = line.substring(4).trim();
          } else if (line.startsWith('mail: ')) {
            user.email = line.substring(6).trim();
          } else if (line.startsWith('givenName: ')) {
            user.firstName = line.substring(11).trim();
          } else if (line.startsWith('sn: ')) {
            user.lastName = line.substring(4).trim();
          } else if (line.startsWith('uid: ')) {
            user.uid = line.substring(5).trim();
          }
        }
        
        // Skip read-only user
        if (user.uid === 'read-only') {
          continue;
        }
        
        if (user.email && user.username && user.uid) {
          // Fix duplicate names: if firstName and lastName are the same, clear lastName
          if (user.firstName && user.lastName && user.firstName === user.lastName) {
            user.lastName = '';
          }
          // If no firstName but has lastName, use lastName as firstName
          if (!user.firstName && user.lastName) {
            user.firstName = user.lastName;
            user.lastName = '';
          }
          users.push(user as LDAPUser);
        }
      }
    }
    
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

/**
 * Get or create the default company for local mode
 * Reusable utility function that ensures a company always exists
 */
async function getOrCreateDefaultCompany(): Promise<Company> {
  const gr = globalResolver;
  const companies = await gr.services.companies.getCompanies();
  let company = companies.getEntities()?.[0];
  
  if (!company) {
    console.log('🏢 No company found, creating default "Tdrive" company');
    const newCompany = getCompanyInstance({
      name: "Tdrive",
      plan: { name: "Local", limits: undefined, features: undefined },
    });
    company = await gr.services.companies.createCompany(newCompany);
    console.log(`✅ Created default company: ${company.name} (${company.id})`);
  } else {
    console.log(`🏢 Using existing company: ${company.name} (${company.id})`);
  }
  
  return company;
}

/**
 * Create user directory structure in the file system
 * This ensures user folders exist for file storage
 */
async function createUserDirectory(userId: string, workspaceId: string): Promise<void> {
  try {
    const userDirPath = `/tdrive/docker-data/files/tdrive/files/${workspaceId}/${userId}`;
    
    // Create directory recursively if it doesn't exist
    if (!fs.existsSync(userDirPath)) {
      fs.mkdirSync(userDirPath, { recursive: true });
      console.log(`   📁 Created user directory: ${userDirPath}`);
    } else {
      console.log(`   📁 User directory already exists: ${userDirPath}`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to create user directory for ${userId}:`, error);
  }
}

/**
 * Reindex users in the search database
 * This ensures users are properly indexed and visible in the frontend
 */
async function reindexUsers(): Promise<void> {
  try {
    console.log('\n🔍 Starting user reindexing...');
    
    // Use the CLI command to reindex users
    return new Promise((resolve, reject) => {
      const reindexProcess = spawn('node', [
        'dist/cli/index.js',
        'search',
        'index',
        '--repository=users',
        '--repairEntities'
      ], {
        stdio: 'inherit'
      });
      
      reindexProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ User reindexing completed successfully');
          resolve();
        } else {
          console.error(`❌ User reindexing failed with code ${code}`);
          // Don't reject, as we want the script to continue even if reindexing fails
          resolve();
        }
      });
      
      reindexProcess.on('error', (err) => {
        console.error('❌ Failed to start reindexing process:', err);
        // Don't reject, as we want the script to continue even if reindexing fails
        resolve();
      });
    });
  } catch (error) {
    console.error('❌ Error during user reindexing:', error);
    // Don't throw, as we want the script to continue even if reindexing fails
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
    
    // Ensure a default company exists before processing users
    const company = await getOrCreateDefaultCompany();
    
    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    let deletedCount = 0;
    
    // Create a map of LDAP uids for deletion detection
    const ldapUids = new Set(ldapUsers.map(u => u.uid));
    
    for (const ldapUser of ldapUsers) {
      try {
        // CRITICAL: Only use uid to find existing users, NEVER email
        // This prevents data loss when email changes in LDAP
        let existingUser = await gr.services.users.getByUsername(ldapUser.uid);
        
        if (existingUser) {
          // Update user information if needed
          let needsUpdate = false;
          
          // Update username_canonical to store uid if not already set
          if (existingUser.username_canonical !== ldapUser.uid) {
            existingUser.username_canonical = ldapUser.uid;
            needsUpdate = true;
          }
          
          // Update email if changed
          if (existingUser.email_canonical !== ldapUser.email.toLowerCase()) {
            console.log(`📧 Email updated: ${ldapUser.uid} (${existingUser.email_canonical} → ${ldapUser.email})`);
            existingUser.email_canonical = ldapUser.email.toLowerCase();
            needsUpdate = true;
          }
          
          // Set default values for first_name and last_name if null
          // Avoid duplicate names by leaving last_name empty if same as first_name
          const newFirstName = ldapUser.firstName || ldapUser.uid.split('@')[0] || '';
          const newLastName = (ldapUser.lastName && ldapUser.lastName !== newFirstName) ? ldapUser.lastName : '';
          
          if (existingUser.first_name !== newFirstName) {
            existingUser.first_name = newFirstName;
            needsUpdate = true;
          }
          if (existingUser.last_name !== newLastName) {
            existingUser.last_name = newLastName;
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
          }
          
          // Ensure user is associated with company
          await gr.services.companies.setUserRole(company.id, existingUser.id, 'member');
          
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
            
            existingUser.preferences = {
              ...existingUser.preferences,
              recent_workspaces: [{ 
                company_id: company.id, 
                workspace_id: createdWorkspace.entity.id 
              }]
            };
          } else {
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
          
          const workspaceId = '77a79af0-7cf5-11f0-b71f-6f7455128b9e';
          await createUserDirectory(existingUser.id, workspaceId);
          
          updatedCount++;
          
        } else {
          const newUser = new User();
          newUser.email_canonical = ldapUser.email.toLowerCase();
          newUser.username_canonical = ldapUser.uid.toLowerCase();
          const firstName = ldapUser.firstName || ldapUser.uid.split('@')[0] || '';
          const lastName = (ldapUser.lastName && ldapUser.lastName !== firstName) ? ldapUser.lastName : '';
          newUser.first_name = firstName;
          newUser.last_name = lastName;
          newUser.password = ''; // No password for LDAP users
          newUser.mail_verified = true;
          newUser.status_icon = '';
          newUser.last_activity = new Date().getTime();
          newUser.creation_date = new Date().getTime();
          newUser.deleted = false;
          // Company is already ensured to exist at this point
          // Add companies field for LDAP users via cache (must be object)
          newUser.cache = {
            companies: [company.id]
          };
          newUser.preferences = {
            recent_workspaces: []
          };
          
          // Create execution context (required by Tdrive API)
          console.log(`🆕 Creating: ${ldapUser.uid} (${ldapUser.email})`);
          
          const context = { user: { id: 'system' } };
          const createdUser = await gr.services.users.create(newUser, context);
          
          await gr.services.companies.setUserRole(company.id, createdUser.entity.id, 'member');
          
          const createdWorkspace = await gr.services.workspaces.create(
            {
              company_id: company.id,
              name: `${createdUser.entity.first_name || createdUser.entity.last_name || createdUser.entity.username_canonical}'s space`,
            } as Workspace,
            { user: { id: createdUser.entity.id } }
          );
          
          createdUser.entity.preferences = {
            ...createdUser.entity.preferences,
            recent_workspaces: [{
              company_id: company.id,
              workspace_id: createdWorkspace.entity.id
            }]
          };
          await gr.services.users.save(createdUser.entity, context);
          
          await createUserDirectory(createdUser.entity.id, createdWorkspace.entity.id);
          
          createdCount++;
          
        }
        
      } catch (userError: any) {
        console.error(`❌ Error: ${ldapUser.uid} - ${userError.message}`);
        errorCount++;
      }
    }
    
    // Delete users from rDrive that no longer exist in LDAP
    try {
      const allRDriveUsers = await gr.services.users.list(
        { limitStr: '1000' },
        {},
        { user: { id: 'system' } }
      );
      
      for (const rdriveUser of allRDriveUsers.getEntities()) {
        // Skip non-LDAP users or already deleted users
        if (!rdriveUser.username_canonical || rdriveUser.deleted || rdriveUser.username_canonical.startsWith('deleted-user-')) {
          continue;
        }
        
        // Check if this user's uid exists in LDAP
        if (!ldapUids.has(rdriveUser.username_canonical)) {
          console.log(`🗑️  Deleting: ${rdriveUser.username_canonical} (${rdriveUser.email_canonical})`);
          
          try {
            await gr.services.users.anonymizeAndDelete(
              { id: rdriveUser.id },
              { user: { id: 'system', server_request: true } },
              true
            );
            
            deletedCount++;
          } catch (deleteError) {
            console.error(`❌ Delete error: ${rdriveUser.username_canonical} - ${deleteError}`);
            errorCount++;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking for deletions:', error);
    }
    
    console.log('\n📊 Sync Summary: 🆕 ' + createdCount + ' created | 🔄 ' + updatedCount + ' updated | 🗑️  ' + deletedCount + ' deleted | ❌ ' + errorCount + ' errors');
    
    if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
      await reindexUsers();
    }
    
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
