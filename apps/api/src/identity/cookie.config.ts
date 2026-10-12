import { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';

export const SESSION_COOKIE_NAME_DEV = 'aurel.sid';
export const SESSION_COOKIE_NAME_PROD = '__Host-aurel.sid';
export const CSRF_COOKIE_NAME_DEV = 'aurel_csrf';
export const CSRF_COOKIE_NAME_PROD = '__Host-aurel_csrf';
export const CSRF_COOKIE_NAME = CSRF_COOKIE_NAME_DEV;

/** 7 days absolute session lifetime in milliseconds (604,800 seconds) */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getSessionCookieName(configService: ConfigService): string {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  return isProduction ? SESSION_COOKIE_NAME_PROD : SESSION_COOKIE_NAME_DEV;
}

export function getCsrfCookieName(configService: ConfigService): string {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  return isProduction ? CSRF_COOKIE_NAME_PROD : CSRF_COOKIE_NAME_DEV;
}

export function getSessionCookieOptions(configService: ConfigService): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    // Note: __Host- prefix mandates no domain attribute and path=/
  };
}

export function getCsrfCookieOptions(configService: ConfigService): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: false, // Double-submit pattern: client SPA must read cookie to submit in X-CSRF-Token header
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function getClearSessionCookieOptions(configService: ConfigService): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  };
}

export function getClearCsrfCookieOptions(configService: ConfigService): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  };
}
