import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterCustomerDto } from './register-customer.dto';

describe('RegisterCustomerDto validation & normalization', () => {
  function transformAndValidate(
    plain: Record<string, unknown>,
  ): Promise<import('class-validator').ValidationError[]> {
    const instance = plainToInstance(RegisterCustomerDto, plain);
    return validate(instance);
  }

  it('should pass validation with valid standard customer payload', async () => {
    const payload = {
      email: 'customer@example.com',
      password: 'StrongPassword#2026',
      fullName: 'Aurel Customer',
    };

    const errors = await transformAndValidate(payload);
    expect(errors.length).toBe(0);
  });

  it('should pass validation with valid optional E.164 phone number', async () => {
    const payload = {
      email: 'customer@example.com',
      password: 'StrongPassword#2026',
      fullName: 'Aurel Customer',
      phone: '+919876543210',
    };

    const errors = await transformAndValidate(payload);
    expect(errors.length).toBe(0);
  });

  it('should normalize and canonicalize email whitespace and uppercase characters', () => {
    const payload = {
      email: '   Customer.Name@EXAMPLE.COM   ',
      password: 'StrongPassword#2026',
      fullName: '   Aurel Customer   ',
    };

    const instance = plainToInstance(RegisterCustomerDto, payload);
    expect(instance.email).toBe('customer.name@example.com');
    expect(instance.fullName).toBe('Aurel Customer');
  });

  it('should reject invalid or malformed email addresses', async () => {
    const invalidEmails = [
      'plainaddress',
      '#@%^%#$@#$@#.com',
      '@example.com',
      'email.example.com',
      'email@example@example.com',
      '',
    ];

    for (const email of invalidEmails) {
      const errors = await transformAndValidate({
        email,
        password: 'ValidPassword123!',
        fullName: 'Valid Name',
      });
      expect(errors.some((err) => err.property === 'email')).toBe(true);
    }
  });

  it('should reject passwords shorter than 8 characters', async () => {
    const errors = await transformAndValidate({
      email: 'valid@example.com',
      password: 'short',
      fullName: 'Valid Name',
    });

    const passwordError = errors.find((err) => err.property === 'password');
    expect(passwordError).toBeDefined();
    expect(passwordError?.constraints).toHaveProperty(
      'minComplexity' in (passwordError?.constraints ?? {}) ? 'minComplexity' : 'minLength',
    );
  });

  it('should reject passwords longer than 128 characters', async () => {
    const longPassword = 'A'.repeat(129);
    const errors = await transformAndValidate({
      email: 'valid@example.com',
      password: longPassword,
      fullName: 'Valid Name',
    });

    const passwordError = errors.find((err) => err.property === 'password');
    expect(passwordError).toBeDefined();
    expect(passwordError?.constraints).toHaveProperty('maxLength');
  });

  it('should reject missing or empty fullName', async () => {
    const errorsEmpty = await transformAndValidate({
      email: 'valid@example.com',
      password: 'ValidPassword123!',
      fullName: '',
    });
    expect(errorsEmpty.some((err) => err.property === 'fullName')).toBe(true);

    const errorsMissing = await transformAndValidate({
      email: 'valid@example.com',
      password: 'ValidPassword123!',
    });
    expect(errorsMissing.some((err) => err.property === 'fullName')).toBe(true);
  });

  it('should reject fullName longer than 100 characters', async () => {
    const longName = 'X'.repeat(101);
    const errors = await transformAndValidate({
      email: 'valid@example.com',
      password: 'ValidPassword123!',
      fullName: longName,
    });

    const nameError = errors.find((err) => err.property === 'fullName');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('maxLength');
  });

  it('should reject invalid phone number formats', async () => {
    const invalidPhones = ['invalid-phone', '123', 'abc12345678', '+0123456789'];
    for (const phone of invalidPhones) {
      const errors = await transformAndValidate({
        email: 'valid@example.com',
        password: 'ValidPassword123!',
        fullName: 'Valid Name',
        phone,
      });
      expect(errors.some((err) => err.property === 'phone')).toBe(true);
    }
  });
});
