import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../../../core/platform/framework';
import User from '../../entities/user';
import CompanyUser from '../../entities/company_user';
import { CompanyUserRole } from '../../web/types';

const execAsync = promisify(exec);

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

  constructor(config: LDAPConfig) {
    this.config = config;
  }

  private buildLDAPCommand(command: string, options: string[] = []): string {
    const baseOptions = [
      '-x',
      `-H ${this.config.url}`,
      `-D "${this.config.bindDN}"`,
      `-w ${this.config.bindPassword}`
    ];
    return `${command} ${baseOptions.concat(options).join(' ')}`;
  }

  async userExists(uid: string): Promise<boolean> {
    try {
      const userDN = `cn=${uid},${this.config.usersDN}`;
      const command = this.buildLDAPCommand('ldapwhoami', [`-D "${userDN}"`]);
      
      // Try to authenticate as the user to check if they exist
      // If the user doesn't exist, this will fail
      await execAsync(command);
      logger.info(`LDAP user exists: ${uid}`);
      return true;
    } catch (error) {
      logger.info(`LDAP user does not exist: ${uid}`);
      return false;
    }
  }

  async createUser(user: User, companyRole: string = 'users'): Promise<void> {
    try {
      const uidNumber = await this.getNextUidNumber();
      const gidNumber = uidNumber; // Using same number for simplicity
      
      const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
      const userDN = `cn=${user.first_name || username},${this.config.usersDN}`;
      
      // Create LDIF content for the new user
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

      // Write LDIF to a temporary file
      const fs = require('fs');
      const tmpFile = `/tmp/user_${username}_${Date.now()}.ldif`;
      fs.writeFileSync(tmpFile, ldifContent);

      try {
        // Use ldapadd to create the user
        const command = this.buildLDAPCommand('ldapadd', ['-f', tmpFile]);
        await execAsync(command);
        logger.info(`LDAP user created: ${userDN}`);
      } finally {
        // Clean up temporary file
        fs.unlinkSync(tmpFile);
      }
    } catch (error) {
      logger.error('LDAP user creation failed:', error);
      throw error;
    }
  }

  async updateUserRole(uid: string, newRole: string): Promise<void> {
    try {
      const userDN = `cn=${uid},${this.config.usersDN}`;
      
      // Create LDIF content for the role update
      const ldifContent = `dn: ${userDN}
changetype: modify
replace: employeeType
employeeType: ${newRole}
`;

      // Write LDIF to a temporary file
      const fs = require('fs');
      const tmpFile = `/tmp/update_${uid}_${Date.now()}.ldif`;
      fs.writeFileSync(tmpFile, ldifContent);

      try {
        // Use ldapmodify to update the user role
        const command = this.buildLDAPCommand('ldapmodify', ['-f', tmpFile]);
        await execAsync(command);
        logger.info(`LDAP user role updated: ${userDN} -> ${newRole}`);
      } finally {
        // Clean up temporary file
        fs.unlinkSync(tmpFile);
      }
    } catch (error) {
      logger.error('LDAP user role update failed:', error);
      throw error;
    }
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
    try {
      // First, find the user's actual DN in LDAP
      const searchCommand = this.buildLDAPCommand('ldapsearch', [
        `-b "${this.config.usersDN}"`,
        `"(&(objectClass=inetOrgPerson)(mail=${email}))"`,
        'dn'
      ]);
      
      const { stdout } = await execAsync(searchCommand);
      
      // Extract the DN from the search result
      const dnMatch = stdout.match(/^dn:\s*(.+)$/m);
      if (!dnMatch) {
        logger.info(`LDAP user not found: ${email}`);
        return false;
      }
      
      const userDN = dnMatch[1].trim();
      logger.debug(`Found LDAP DN for ${email}: ${userDN}`);
      
      // Try to authenticate using ldapwhoami with the user's credentials
      // Don't use buildLDAPCommand here as it adds admin credentials
      const authCommand = `ldapwhoami -x -H ${this.config.url} -D "${userDN}" -w "${password}"`;
      
      await execAsync(authCommand);
      logger.info(`LDAP authentication successful for user: ${email}`);
      return true;
    } catch (error) {
      logger.info(`LDAP authentication failed for user: ${email} - ${error.message}`);
      return false;
    }
  }

  async isLDAPUser(email: string): Promise<boolean> {
    try {
      // Check if user exists in LDAP by trying to find them
      const username = email.split('@')[0];
      const command = this.buildLDAPCommand('ldapsearch', [
        `-b "${this.config.usersDN}"`,
        `"(&(objectClass=inetOrgPerson)(mail=${email}))"`,
        'cn'
      ]);
      
      const { stdout } = await execAsync(command);
      
      // If we get any results, the user exists in LDAP
      return stdout.includes('dn:');
    } catch (error) {
      logger.debug(`LDAP user check failed for: ${email}`);
      return false;
    }
  }

  private async getNextUidNumber(): Promise<number> {
    try {
      // Search for all posixAccount entries and get their uidNumber
      const command = this.buildLDAPCommand('ldapsearch', [
        `-b "${this.config.usersDN}"`,
        `"(objectClass=posixAccount)"`,
        'uidNumber'
      ]);
      
      const { stdout } = await execAsync(command);
      
      let maxUid = 1002; // Start from 1003 (after system accounts)
      
      // Parse the output to find uidNumber values
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
      // Return a default starting UID if search fails
      return 1003;
    }
  }
}

// LDAP configuration from environment variables
export const defaultLDAPConfig: LDAPConfig = {
  url: process.env.LDAP_URL || 'ldap://localhost:389',
  bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=example,dc=org',
  bindPassword: process.env.LDAP_BIND_PASSWORD || 'adminpassword',
  baseDN: process.env.LDAP_BASE_DN || 'dc=example,dc=org',
  usersDN: process.env.LDAP_USERS_DN || 'ou=users,dc=example,dc=org',
  groupsDN: process.env.LDAP_GROUPS_DN || 'ou=groups,dc=example,dc=org',
};
