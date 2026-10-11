import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  it('should successfully validate configuration with valid DATABASE_URL and defaults', () => {
    const config = {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/aurel_dev',
    };

    const validated = validateEnvironment(config);

    expect(validated.DATABASE_URL).toBe(config.DATABASE_URL);
    expect(validated.PORT).toBe(4000);
    expect(validated.NODE_ENV).toBe('development');
    expect(validated.API_PREFIX).toBe('api/v1');
  });

  it('should throw an error when DATABASE_URL is missing', () => {
    const config = {
      PORT: 4000,
    };

    expect(() => validateEnvironment(config)).toThrow(/Environment validation failed/);
  });
});
