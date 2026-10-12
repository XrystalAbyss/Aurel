import 'reflect-metadata';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Strict boolean transformer for security-sensitive environment variables.
 *
 * Security Rationale:
 * Default JavaScript Boolean("false") evaluates to `true`, and class-transformer's
 * enableImplicitConversion coerces non-empty strings using Boolean(value).
 * This can silently turn `TRUST_PROXY=false` into `true`, dangerously exposing
 * internal rate-limiting to spoofed client IP headers.
 *
 * Rules:
 * 1. Undefined, null, or empty string "" defaults to `defaultValue` (normally false).
 * 2. Literal boolean true/false is preserved.
 * 3. Exact case-insensitive string "true" / "false" (with surrounding whitespace trimmed) is parsed.
 * 4. All other values (numeric strings "0"/"1", numbers 0/1, "yes"/"no", ambiguous/malformed strings)
 *    are returned uncoerced so class-validator's @IsBoolean() rejects them with a descriptive error.
 */
export function TransformStrictBoolean(defaultValue = false) {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
      // Return uncoerced string so @IsBoolean fails validation
      return value;
    }
    // Return uncoerced object/number so @IsBoolean fails validation
    return value;
  });
}

export class EnvironmentVariables {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(Environment, {
    message: 'NODE_ENV must be one of: development, production, test',
  })
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsInt({ message: 'PORT must be an integer between 1 and 65535' })
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 4000;

  @IsString({ message: 'DATABASE_URL must be a valid connection string' })
  DATABASE_URL!: string;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api/v1';

  @IsString()
  @IsOptional()
  CORS_ALLOWED_ORIGINS: string = 'http://localhost:5173,http://localhost:5174';

  @IsString()
  @IsOptional()
  SESSION_SECRET: string = 'default_insecure_development_secret_32_chars';

  @IsString()
  @IsOptional()
  CSRF_SECRET: string = 'default_insecure_csrf_secret_min_32_chars';

  @TransformStrictBoolean(false)
  @IsBoolean({ message: 'TRUST_PROXY must be an explicit boolean ("true" or "false")' })
  @IsOptional()
  TRUST_PROXY: boolean = false;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  // Disable implicit conversion to prevent class-transformer from coercing "false" strings to boolean true
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => Object.values(err.constraints || {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  // Strict production assertions
  if (validatedConfig.NODE_ENV === Environment.Production) {
    if (
      !validatedConfig.SESSION_SECRET ||
      validatedConfig.SESSION_SECRET.includes('default_insecure') ||
      validatedConfig.SESSION_SECRET.length < 32
    ) {
      throw new Error(
        'Production security violation: SESSION_SECRET must be explicitly set and >= 32 characters in production.',
      );
    }

    if (
      !validatedConfig.CSRF_SECRET ||
      validatedConfig.CSRF_SECRET.includes('default_insecure') ||
      validatedConfig.CSRF_SECRET.length < 32
    ) {
      throw new Error(
        'Production security violation: CSRF_SECRET must be explicitly set and >= 32 characters in production.',
      );
    }

    if (validatedConfig.CORS_ALLOWED_ORIGINS.includes('*')) {
      throw new Error(
        'Production security violation: Wildcard CORS origins are forbidden when credentials/cookies are enabled.',
      );
    }
  }

  return validatedConfig;
}
