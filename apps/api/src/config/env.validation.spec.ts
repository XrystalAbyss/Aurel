import { Environment, validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const baseValidConfig = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/aurel_dev',
  };

  describe('Baseline Configuration', () => {
    it('should successfully validate configuration with valid DATABASE_URL and defaults', () => {
      const validated = validateEnvironment(baseValidConfig);

      expect(validated.DATABASE_URL).toBe(baseValidConfig.DATABASE_URL);
      expect(validated.PORT).toBe(4000);
      expect(validated.NODE_ENV).toBe(Environment.Development);
      expect(validated.API_PREFIX).toBe('api/v1');
      expect(validated.TRUST_PROXY).toBe(false);
    });

    it('should throw an error when DATABASE_URL is missing', () => {
      const config = {
        PORT: 4000,
      };

      expect(() => validateEnvironment(config)).toThrow(
        /DATABASE_URL must be a valid connection string/,
      );
    });
  });

  describe('TRUST_PROXY Strict Boolean Parsing (Gate P2.2.3)', () => {
    it('defaults TRUST_PROXY to false when unset', () => {
      const validated = validateEnvironment({ ...baseValidConfig });
      expect(validated.TRUST_PROXY).toBe(false);
    });

    it('defaults TRUST_PROXY to false when empty string is provided', () => {
      const validated = validateEnvironment({ ...baseValidConfig, TRUST_PROXY: '' });
      expect(validated.TRUST_PROXY).toBe(false);
    });

    it('preserves literal boolean false', () => {
      const validated = validateEnvironment({ ...baseValidConfig, TRUST_PROXY: false });
      expect(validated.TRUST_PROXY).toBe(false);
    });

    it('preserves literal boolean true', () => {
      const validated = validateEnvironment({ ...baseValidConfig, TRUST_PROXY: true });
      expect(validated.TRUST_PROXY).toBe(true);
    });

    it('correctly parses literal string "false" as boolean false (NOT coerced to true)', () => {
      // CRITICAL SECURITY REGRESSION: Boolean("false") === true in JavaScript.
      // Must be strictly parsed to boolean false.
      const validated = validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'false' });
      expect(validated.TRUST_PROXY).toBe(false);
    });

    it('correctly parses literal string "true" as boolean true', () => {
      const validated = validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'true' });
      expect(validated.TRUST_PROXY).toBe(true);
    });

    it('handles uppercase variants "TRUE" and "FALSE"', () => {
      expect(validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'TRUE' }).TRUST_PROXY).toBe(
        true,
      );
      expect(validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'FALSE' }).TRUST_PROXY).toBe(
        false,
      );
    });

    it('handles mixed case variants "True" and "False"', () => {
      expect(validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'True' }).TRUST_PROXY).toBe(
        true,
      );
      expect(validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'False' }).TRUST_PROXY).toBe(
        false,
      );
    });

    it('handles whitespace-padded variants "  true  " and "  false  "', () => {
      expect(validateEnvironment({ ...baseValidConfig, TRUST_PROXY: '  true  ' }).TRUST_PROXY).toBe(
        true,
      );
      expect(
        validateEnvironment({ ...baseValidConfig, TRUST_PROXY: '  false  ' }).TRUST_PROXY,
      ).toBe(false);
    });

    it('rejects numeric-looking string "0" with a validation error', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: '0' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
    });

    it('rejects numeric-looking string "1" with a validation error', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: '1' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
    });

    it('rejects raw numeric literals 0 and 1', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 0 })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 1 })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
    });

    it('rejects common ambiguous truthy/falsy strings ("yes", "no", "enabled", "disabled")', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'yes' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'no' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'enabled' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'disabled' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
    });

    it('rejects arbitrary malformed strings without silently enabling proxy trust', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'invalid' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'true1' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, TRUST_PROXY: 'null' })).toThrow(
        /TRUST_PROXY must be an explicit boolean/,
      );
    });
  });

  describe('PORT Validation', () => {
    it('parses valid port string to number', () => {
      const validated = validateEnvironment({ ...baseValidConfig, PORT: '8080' });
      expect(validated.PORT).toBe(8080);
    });

    it('rejects invalid non-numeric port strings', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, PORT: 'invalid_port' })).toThrow(
        /PORT must be an integer between 1 and 65535/,
      );
    });

    it('rejects out-of-range port numbers', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, PORT: '0' })).toThrow(
        /PORT must not be less than 1/,
      );
      expect(() => validateEnvironment({ ...baseValidConfig, PORT: '70000' })).toThrow(
        /PORT must not be greater than 65535/,
      );
    });
  });

  describe('NODE_ENV Validation', () => {
    const validProdSecrets = {
      SESSION_SECRET: 'production_session_secret_at_least_32_characters_long_12345',
      CSRF_SECRET: 'production_csrf_secret_at_least_32_characters_long_12345',
      CORS_ALLOWED_ORIGINS: 'https://aurel.restaurant',
    };

    it('normalizes uppercase and mixed-case NODE_ENV values', () => {
      expect(
        validateEnvironment({ ...baseValidConfig, ...validProdSecrets, NODE_ENV: 'PRODUCTION' })
          .NODE_ENV,
      ).toBe(Environment.Production);
      expect(validateEnvironment({ ...baseValidConfig, NODE_ENV: 'Test' }).NODE_ENV).toBe(
        Environment.Test,
      );
      expect(
        validateEnvironment({ ...baseValidConfig, NODE_ENV: '  development  ' }).NODE_ENV,
      ).toBe(Environment.Development);
    });

    it('rejects unsupported NODE_ENV values', () => {
      expect(() => validateEnvironment({ ...baseValidConfig, NODE_ENV: 'staging' })).toThrow(
        /NODE_ENV must be one of: development, production, test/,
      );
    });
  });

  describe('Production Security Invariants', () => {
    const validProductionSecrets = {
      ...baseValidConfig,
      NODE_ENV: 'production',
      SESSION_SECRET: 'production_session_secret_at_least_32_characters_long_12345',
      CSRF_SECRET: 'production_csrf_secret_at_least_32_characters_long_12345',
      CORS_ALLOWED_ORIGINS: 'https://aurel.restaurant',
    };

    it('passes validation when production configuration meets all security rules', () => {
      const validated = validateEnvironment(validProductionSecrets);
      expect(validated.NODE_ENV).toBe(Environment.Production);
      expect(validated.SESSION_SECRET).toBe(validProductionSecrets.SESSION_SECRET);
      expect(validated.CSRF_SECRET).toBe(validProductionSecrets.CSRF_SECRET);
    });

    it('rejects default insecure SESSION_SECRET in production', () => {
      expect(() =>
        validateEnvironment({
          ...validProductionSecrets,
          SESSION_SECRET: 'default_insecure_development_secret_32_chars',
        }),
      ).toThrow(/SESSION_SECRET must be explicitly set and >= 32 characters in production/);
    });

    it('rejects short SESSION_SECRET (< 32 chars) in production', () => {
      expect(() =>
        validateEnvironment({
          ...validProductionSecrets,
          SESSION_SECRET: 'short_secret_under_32_chars',
        }),
      ).toThrow(/SESSION_SECRET must be explicitly set and >= 32 characters in production/);
    });

    it('rejects default insecure CSRF_SECRET in production', () => {
      expect(() =>
        validateEnvironment({
          ...validProductionSecrets,
          CSRF_SECRET: 'default_insecure_csrf_secret_min_32_chars',
        }),
      ).toThrow(/CSRF_SECRET must be explicitly set and >= 32 characters in production/);
    });

    it('rejects wildcard CORS origins in production', () => {
      expect(() =>
        validateEnvironment({
          ...validProductionSecrets,
          CORS_ALLOWED_ORIGINS: 'https://aurel.restaurant, *',
        }),
      ).toThrow(/Wildcard CORS origins are forbidden when credentials\/cookies are enabled/);
    });
  });
});
