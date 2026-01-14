import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../../../core/platform/framework';
import User from '../../entities/user';
import CompanyUser from '../../entities/company_user';
import { CompanyUserRole } from '../../web/types';

const execAsync = promisify(exec);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface LDAPConfig {
  url: string;
  bindDN: string;
  bindPassword: string;
  baseDN: string;
  usersDN: string;
  groupsDN: string;
}

export interface LDAPUser {
  cn: string;
  sn: string;
  uid: string;
  mail: string;
  employeeType: string;
  userPassword: string;
  uidNumber: number;
  gidNumber: number;
  homeDirectory: string;
}

export class LDAPSyncService {
  private config: LDAPConfig;
  private maxRetries: number = 3;
  private retryDelayMs: number = 2000;

  constructor(config: LDAPConfig) {
    this.config = config;
    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.config.bindPassword || this.config.bindPassword === 'adminpassword') {
      logger.warn('⚠️  LDAP_BIND_PASSWORD is not set or using default value. Please set LDAP_BIND_PASSWORD environment variable.');
      logger.warn(`Current LDAP_BIND_PASSWORD from env: ${process.env.LDAP_BIND_PASSWORD || 'NOT SET'}`);
    }
    logger.info(`LDAP Configuration loaded:`);
    logger.info(`  - URL: ${this.config.url}`);
    logger.info(`  - Bind DN: ${this.config.bindDN}`);
    logger.info(`  - Password set: ${this.config.bindPassword ? 'YES' : 'NO'}`);
    logger.info(`  - Users DN: ${this.config.usersDN}`);
  }

  private buildLDAPCommand(command: string, options: string[] = []): string {
    const baseOptions = [
      '-x',
      `-H ${this.config.url}`,
      `-D "${this.config.bindDN}"`,
      `-w "${this.config.bindPassword}"`
    ];
    return `${command} ${baseOptions.concat(options).join(' ')}`;
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`${operationName} - Attempt ${attempt}/${this.maxRetries}`);
        const result = await operation();
        if (attempt > 1) {
          logger.info(`${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error: any) {
        lastError = error;
        logger.warn(`${operationName} failed on attempt ${attempt}/${this.maxRetries}: ${error.message}`);
        
        if (error.message?.includes('Invalid credentials') || error.message?.includes('authentication')) {
          logger.error(`❌ LDAP Authentication Error: Invalid credentials. Please verify LDAP_BIND_PASSWORD is correct.`);
          logger.error(`Current LDAP_BIND_PASSWORD from env: ${process.env.LDAP_BIND_PASSWORD || 'NOT SET'}`);
          throw error;
        }
        
        if (attempt < this.maxRetries) {
          logger.info(`Retrying in ${this.retryDelayMs}ms...`);
          await sleep(this.retryDelayMs);
        }
      }
    }
    
    logger.error(`${operationName} failed after ${this.maxRetries} attempts`);
    throw lastError;
  }

  async userExists(uid: string): Promise<boolean> {
    return this.executeWithRetry(async () => {
      try {
        const userDN = `cn=${uid},${this.config.usersDN}`;
        const command = this.buildLDAPCommand('ldapwhoami', [`-D "${userDN}"`]);
        
        await execAsync(command);
        logger.info(`LDAP user exists: ${uid}`);
        return true;
      } catch (error) {
        logger.info(`LDAP user does not exist: ${uid}`);
        return false;
      }
    }, `Check if user exists: ${uid}`);
  }

  async createUser(user: User, companyRole: string = 'users'): Promise<void> {
    return this.executeWithRetry(async () => {
      try {
        const uidNumber = await this.getNextUidNumber();
        const gidNumber = uidNumber;
        
        const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
        const userDN = `cn=${user.first_name || username},${this.config.usersDN}`;
        
        const ldifContent = `dn: ${userDN}
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
cn: ${user.first_name || username}
sn: ${user.last_name || username}
uid: ${username}
mail: ${user.email_canonical}
employeeType: ${companyRole}
userPassword: ${user.password || 'defaultpassword'}
uidNumber: ${uidNumber}
gidNumber: ${gidNumber}
homeDirectory: /home/${username}
`;

        const fs = require('fs');
        const tmpFile = `/tmp/user_${username}_${Date.now()}.ldif`;
        fs.writeFileSync(tmpFile, ldifContent);

        try {
          const command = this.buildLDAPCommand('ldapadd', ['-f', tmpFile]);
          await execAsync(command);
          logger.info(`LDAP user created: ${userDN}`);
        } finally {
          fs.unlinkSync(tmpFile);
        }
      } catch (error) {
        logger.error('LDAP user creation failed:', error);
        throw error;
      }
    }, `Create LDAP user: ${user.email_canonical}`);
  }

  async updateUserRole(uid: string, newRole: string): Promise<void> {
    return this.executeWithRetry(async () => {
      try {
        const userDN = `cn=${uid},${this.config.usersDN}`;
        
        const ldifContent = `dn: ${userDN}
changetype: modify
replace: employeeType
employeeType: ${newRole}
`;

        const fs = require('fs');
        const tmpFile = `/tmp/update_${uid}_${Date.now()}.ldif`;
        fs.writeFileSync(tmpFile, ldifContent);

        try {
          const command = this.buildLDAPCommand('ldapmodify', ['-f', tmpFile]);
          await execAsync(command);
          logger.info(`LDAP user role updated: ${userDN} -> ${newRole}`);
        } finally {
          fs.unlinkSync(tmpFile);
        }
      } catch (error) {
        logger.error('LDAP user role update failed:', error);
        throw error;
      }
    }, `Update LDAP user role: ${uid}`);
  }

  async syncUserToLDAP(user: User, companyUsers: CompanyUser[]): Promise<void> {
    try {
      const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
      const exists = await this.userExists(username);
      
      if (!exists) {
        // Determine the role based on company users
        const role = this.determineUserRole(companyUsers);
        await this.createUser(user, role);
        logger.info(`User ${username} created in LDAP with role: ${role}`);
      } else {
        // Update role if user exists
        const role = this.determineUserRole(companyUsers);
        await this.updateUserRole(username, role);
        logger.info(`User ${username} role updated in LDAP to: ${role}`);
      }
    } catch (error) {
      const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
      logger.error('LDAP sync failed for user:', username, error);
      throw error;
    }
  }

  private determineUserRole(companyUsers: CompanyUser[]): string {
    // Determine the highest role across all companies
    const roles = companyUsers.map(cu => cu.role);
    
    if (roles.includes('admin')) {
      return 'admins';
    } else if (roles.includes('member')) {
      return 'users';
    } else {
      return 'users'; // Default role
    }
  }

  async authenticateUser(email: string, password: string): Promise<boolean> {
    return this.executeWithRetry(async () => {
      try {
        const searchCommand = this.buildLDAPCommand('ldapsearch', [
          `-b "${this.config.usersDN}"`,
          `"(&(objectClass=inetOrgPerson)(mail=${email}))"`,
          'dn'
        ]);
        
        const { stdout } = await execAsync(searchCommand);
        
        const dnMatch = stdout.match(/^dn:\s*(.+)$/m);
        if (!dnMatch) {
          logger.info(`LDAP user not found: ${email}`);
          return false;
        }
        
        const userDN = dnMatch[1].trim();
        logger.debug(`Found LDAP DN for ${email}: ${userDN}`);
        
        const authCommand = `ldapwhoami -x -H ${this.config.url} -D "${userDN}" -w "${password}"`;
        
        await execAsync(authCommand);
        logger.info(`LDAP authentication successful for user: ${email}`);
        return true;
      } catch (error) {
        logger.info(`LDAP authentication failed for user: ${email} - ${error.message}`);
        return false;
      }
    }, `Authenticate LDAP user: ${email}`);
  }

  async isLDAPUser(email: string): Promise<boolean> {
    return this.executeWithRetry(async () => {
      try {
        const username = email.split('@')[0];
        const command = this.buildLDAPCommand('ldapsearch', [
          `-b "${this.config.usersDN}"`,
          `"(&(objectClass=inetOrgPerson)(mail=${email}))"`,
          'cn'
        ]);
        
        const { stdout } = await execAsync(command);
        
        return stdout.includes('dn:');
      } catch (error) {
        logger.debug(`LDAP user check failed for: ${email}`);
        return false;
      }
    }, `Check if LDAP user exists: ${email}`);
  }

  private async getNextUidNumber(): Promise<number> {
    return this.executeWithRetry(async () => {
      try {
        const command = this.buildLDAPCommand('ldapsearch', [
          `-b "${this.config.usersDN}"`,
          `"(objectClass=posixAccount)"`,
          'uidNumber'
        ]);
        
        const { stdout } = await execAsync(command);
        
        let maxUid = 1002;
        
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.startsWith('uidNumber: ')) {
            const uidNumber = parseInt(line.split('uidNumber: ')[1]);
            if (uidNumber > maxUid) {
              maxUid = uidNumber;
            }
          }
        }
        
        return maxUid + 1;
      } catch (error) {
        logger.error('LDAP search for uidNumber failed:', error);
        return 1003;
      }
    }, 'Get next UID number');
  }
}

// LDAP configuration from environment variables
function getLDAPConfig(): LDAPConfig {
  const password = process.env.LDAP_BIND_PASSWORD;
  
  if (!password) {
    logger.error('❌ CRITICAL: LDAP_BIND_PASSWORD environment variable is not set!');
    logger.error('Please set LDAP_BIND_PASSWORD in your .env file or docker-compose.yml');
    throw new Error('LDAP_BIND_PASSWORD is required but not set');
  }
  
  if (password === 'adminpassword') {
    logger.warn('⚠️  WARNING: LDAP_BIND_PASSWORD is using the default value "adminpassword"');
    logger.warn('This is likely incorrect. Please verify your LDAP configuration.');
  }
  
  return {
    url: process.env.LDAP_URL || 'ldap://localhost:389',
    bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=example,dc=org',
    bindPassword: password,
    baseDN: process.env.LDAP_BASE_DN || 'dc=example,dc=org',
    usersDN: process.env.LDAP_USERS_DN || 'ou=users,dc=example,dc=org',
    groupsDN: process.env.LDAP_GROUPS_DN || 'ou=groups,dc=example,dc=org',
  };
}

export const defaultLDAPConfig: LDAPConfig = getLDAPConfig();
