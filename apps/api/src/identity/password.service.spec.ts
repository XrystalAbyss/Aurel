import { PasswordService, ARGON2ID_OPTIONS } from './password.service';

describe('PasswordService', () => {
  let passwordService: PasswordService;

  beforeEach(() => {
    passwordService = new PasswordService();
  });

  it('should be configured with OWASP/RFC 9106 recommended Argon2id parameters', () => {
    expect(ARGON2ID_OPTIONS.type).toBe(2); // argon2id
    expect(ARGON2ID_OPTIONS.memoryCost).toBe(65536); // 64 MiB
    expect(ARGON2ID_OPTIONS.timeCost).toBe(3); // 3 iterations
    expect(ARGON2ID_OPTIONS.parallelism).toBe(4); // 4 threads
    expect(ARGON2ID_OPTIONS.raw).toBe(false);
  });

  it('should generate a valid encoded Argon2id hash string starting with $argon2id$', async () => {
    const plain = 'StrongPassphrase#2026';
    const hash = await passwordService.hash(plain);

    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$argon2id$v=19$m=65536,p=4,t=3$')).toBe(true);
    expect(hash).not.toBe(plain);
    expect(hash).not.toContain(plain);
  });

  it('should generate distinct hashes for the same password due to unique cryptographic salts', async () => {
    const plain = 'IdenticalPassword123!';
    const hash1 = await passwordService.hash(plain);
    const hash2 = await passwordService.hash(plain);

    expect(hash1).not.toBe(hash2);
    expect(await passwordService.verify(hash1, plain)).toBe(true);
    expect(await passwordService.verify(hash2, plain)).toBe(true);
  });

  it('should successfully verify a correct password against its hash', async () => {
    const plain = 'CorrectHorseBatteryStaple!';
    const hash = await passwordService.hash(plain);

    const isValid = await passwordService.verify(hash, plain);
    expect(isValid).toBe(true);
  });

  it('should fail verification when given an incorrect password', async () => {
    const plain = 'SecretPassword123$';
    const wrong = 'WrongPassword456%';
    const hash = await passwordService.hash(plain);

    const isValid = await passwordService.verify(hash, wrong);
    expect(isValid).toBe(false);
  });

  it('should handle Unicode and complex passphrases safely without truncation', async () => {
    const unicodePassword = '🔑Passphrase_with_ümlaut_öäü_and_emojis_🍱🍜#99';
    const hash = await passwordService.hash(unicodePassword);

    expect(await passwordService.verify(hash, unicodePassword)).toBe(true);
    expect(await passwordService.verify(hash, unicodePassword + 'x')).toBe(false);
  });

  it('should safely return false and not throw when verifying against malformed hashes or empty inputs', async () => {
    expect(await passwordService.verify('invalid-hash-string', 'password')).toBe(false);
    expect(await passwordService.verify('', 'password')).toBe(false);
    expect(await passwordService.verify('$argon2id$v=19$malformed', 'password')).toBe(false);
    expect(await passwordService.verify(null as unknown as string, 'password')).toBe(false);
    expect(await passwordService.verify(undefined as unknown as string, 'password')).toBe(false);
    expect(await passwordService.verify('some-hash', '' as unknown as string)).toBe(false);
  });
});
