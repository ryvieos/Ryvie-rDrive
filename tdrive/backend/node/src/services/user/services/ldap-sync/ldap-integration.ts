import { ExecutionContext } from '../../../../core/platform/framework/api/crud-service';
import { logger } from '../../../../core/platform/framework';
import User from '../../entities/user';
import CompanyUser from '../../entities/company_user';
import { LDAPSyncService, defaultLDAPConfig } from './ldap-service';
import gr from '../../../global-resolver';

export class LDAPIntegrationService {
  private ldapService: LDAPSyncService;

  constructor() {
    this.ldapService = new LDAPSyncService(defaultLDAPConfig);
  }

  /**
   * Synchronizes a user with LDAP after user creation or update
   * This method should be called after a user is created or their company roles are updated
   */
  async syncUserWithLDAP(user: User, context?: ExecutionContext): Promise<void> {
    try {
      // Get user's company associations
      const companyUsers = await gr.services.users.getUserCompanies({ id: user.id }, context);
      
      if (companyUsers && companyUsers.length > 0) {
        // Sync user to LDAP with their roles
        await this.ldapService.syncUserToLDAP(user, companyUsers);
        const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
        logger.info(`Successfully synced user ${username} with LDAP`);
      } else {
        const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
        logger.warn(`User ${username} has no company associations, skipping LDAP sync`);
      }
    } catch (error) {
      const username = user.username_canonical || user.email_canonical?.split('@')[0] || 'user';
      logger.error(`Failed to sync user ${username} with LDAP:`, error);
      // Don't throw the error to avoid breaking user creation process
      // LDAP sync is optional and shouldn't prevent user creation
    }
  }

  /**
   * Synchronizes a user's role when their company role changes
   */
  async syncUserRoleChange(userId: string, context?: ExecutionContext): Promise<void> {
    try {
      const user = await gr.services.users.get({ id: userId }, context);
      if (!user) {
        logger.error(`User with id ${userId} not found for LDAP role sync`);
        return;
      }

      await this.syncUserWithLDAP(user, context);
    } catch (error) {
      logger.error(`Failed to sync user role change for user ${userId}:`, error);
    }
  }

  /**
   * Batch sync multiple users with LDAP
   * Useful for initial setup or bulk operations
   */
  async batchSyncUsers(userIds: string[], context?: ExecutionContext): Promise<void> {
    logger.info(`Starting batch LDAP sync for ${userIds.length} users`);
    
    for (const userId of userIds) {
      try {
        await this.syncUserRoleChange(userId, context);
        // Add a small delay to avoid overwhelming LDAP server
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Failed to sync user ${userId} in batch operation:`, error);
        // Continue with other users even if one fails
      }
    }
    
    logger.info(`Completed batch LDAP sync for ${userIds.length} users`);
  }

  /**
   * Authenticate a user against LDAP
   * Returns true if authentication is successful, false otherwise
   */
  async authenticateUserWithLDAP(email: string, password: string): Promise<boolean> {
    try {
      return await this.ldapService.authenticateUser(email, password);
    } catch (error) {
      logger.error(`LDAP authentication error for user ${email}:`, error);
      return false;
    }
  }

  /**
   * Check if a user exists in LDAP
   * Returns true if user exists in LDAP, false otherwise
   */
  async isLDAPUser(email: string): Promise<boolean> {
    try {
      return await this.ldapService.isLDAPUser(email);
    } catch (error) {
      logger.error(`LDAP user check error for ${email}:`, error);
      return false;
    }
  }
}

// Export singleton instance
export const ldapIntegration = new LDAPIntegrationService();
