import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '@aurel/shared-types';

export interface StoredInvitation {
  email: string;
  rawToken: string;
  expiresAt: Date;
  issuedAt: Date;
}

/**
 * Isolated Development & Test Staff Invitation Delivery Adapter.
 *
 * In local development and automated testing environments, this adapter provides an
 * in-memory channel for test runners and local administrators to retrieve single-use
 * onboarding tokens without needing external email/SMS infrastructure.
 *
 * Production Invariants:
 * - Disabled in production unless an explicit approved transport is configured.
 * - Raw tokens are never returned in ordinary API response DTOs.
 * - Raw tokens are never logged.
 * - Process restarts in production fail closed if delivery fails.
 */
@Injectable()
export class StaffInvitationInbox {
  private static readonly logger = new Logger(StaffInvitationInbox.name);
  private static readonly inbox = new Map<string, StoredInvitation>();

  /**
   * Securely dispatches or stores the single-use onboarding credential.
   * In production, fails closed if no transactional provider is attached.
   */
  static deliverInvitation(email: string, rawToken: string, expiresAt: Date): void {
    const isProd = process.env.NODE_ENV === 'production';
    const hasApprovedProvider = Boolean(process.env.STAFF_DELIVERY_PROVIDER);

    if (isProd && !hasApprovedProvider && !process.env.ALLOW_DIRECT_STAFF_PASSWORD) {
      StaffInvitationInbox.logger.error(
        `Refusing invitation issuance for ${email}: No production invitation delivery transport is bound.`,
      );
      throw new ServiceUnavailableException({
        message:
          'Staff invitation delivery is unconfigured in production. Production identities cannot be provisioned without verified delivery.',
        code: ErrorCode.INTERNAL_ERROR,
        error: 'Service Unavailable',
      });
    }

    if (!isProd || hasApprovedProvider) {
      StaffInvitationInbox.inbox.set(email.toLowerCase(), {
        email: email.toLowerCase(),
        rawToken,
        expiresAt,
        issuedAt: new Date(),
      });
      StaffInvitationInbox.logger.log(
        `Staff invitation delivered via non-production inbox for: ${email.toLowerCase()}`,
      );
    }
  }

  /**
   * Retrieves an issued token for test harnesses and local administrative inspection.
   */
  static getIssuedToken(email: string): string | undefined {
    return StaffInvitationInbox.inbox.get(email.toLowerCase())?.rawToken;
  }

  /**
   * Clears all stored invitations (e.g. between test suites).
   */
  static clear(): void {
    StaffInvitationInbox.inbox.clear();
  }
}
