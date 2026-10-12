import 'reflect-metadata';
import { Type, plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsNumber()
  PORT: number = 4000;

  @IsString()
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

  @Type(() => Boolean)
  @IsOptional()
  TRUST_PROXY: boolean = false;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
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
