import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * OWASP and RFC 9106 recommended Argon2id parameters for password hashing.
 * - type: argon2id (hybrid defense against side-channel and GPU/ASIC attacks)
 * - memoryCost: 65536 KiB (64 MiB)
 * - timeCost: 3 iterations
 * - parallelism: 4 lanes/threads
 */
export const ARGON2ID_OPTIONS: argon2.HashOptions & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  raw: false,
};

export const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$EpXycs6kjozovwM4ABMvXQ$+oW4ehZbic0i9KU/PSr/I96TueowCA+mcsaydZChoGA';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hashes a plaintext password using Argon2id with cryptographically random salts.
   *
   * @param password Plaintext password to hash
   * @returns Encoded Argon2id hash string including parameters and salt
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2ID_OPTIONS);
  }

  /**
   * Verifies a plaintext password against an encoded Argon2id hash string.
   *
   * @param hash Encoded hash string
   * @param plain Plaintext password candidate
   * @returns True if candidate matches hash, false otherwise
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      if (!hash || !plain || typeof hash !== 'string' || typeof plain !== 'string') {
        return false;
      }
      return await argon2.verify(hash, plain);
    } catch {
      // Safely catch malformed hash errors or cryptographic mismatches without crashing
      this.logger.warn('Password verification failed due to invalid hash format or internal error');
      return false;
    }
  }

  /**
   * Executes a constant-time dummy verification against a standardized Argon2id hash.
   * Eliminates user enumeration side channels caused by timing discrepancies when accounts do not exist.
   */
  async verifyDummy(plain: string): Promise<boolean> {
    try {
      if (!plain || typeof plain !== 'string') {
        return false;
      }
      await argon2.verify(DUMMY_ARGON2ID_HASH, plain);
      return false;
    } catch {
      return false;
    }
  }
}
