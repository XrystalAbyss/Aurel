import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';

describe('LoginDto Validation Unit Tests', () => {
  function toDto(plain: Record<string, unknown>): LoginDto {
    return plainToInstance(LoginDto, plain);
  }

  it('passes validation for valid login credentials', async () => {
    const dto = toDto({
      email: 'customer@example.com',
      password: 'ValidSecurePassphrase#2026',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when email is missing or empty', async () => {
    const dto = toDto({
      password: 'ValidSecurePassphrase#2026',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('email');
  });

  it('fails validation when email format is invalid', async () => {
    const dto = toDto({
      email: 'not-an-email-format',
      password: 'ValidSecurePassphrase#2026',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.isEmail).toBeDefined();
  });

  it('fails validation when email exceeds 255 characters', async () => {
    const dto = toDto({
      email: `${'a'.repeat(250)}@example.com`,
      password: 'ValidSecurePassphrase#2026',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.maxLength).toBeDefined();
  });

  it('fails validation when password is empty', async () => {
    const dto = toDto({
      email: 'customer@example.com',
      password: '',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('password');
  });

  it('fails validation when password exceeds 128 characters', async () => {
    const dto = toDto({
      email: 'customer@example.com',
      password: 'p'.repeat(129),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.maxLength).toBeDefined();
  });
});
