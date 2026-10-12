import { CsrfService } from './csrf.service';
import { ConfigService } from '@nestjs/config';

describe('CsrfService Unit Tests', () => {
  let service: CsrfService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'CSRF_SECRET') return 'test_csrf_secret_min_32_characters_abcdef';
        if (key === 'CORS_ALLOWED_ORIGINS') return 'http://localhost:5173,https://aurel.restaurant';
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new CsrfService(mockConfigService);
  });

  describe('generateToken', () => {
    it('generates a 3-part token bound to sessionId with random nonce and HMAC', () => {
      const sessionId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      const token = service.generateToken(sessionId);

      const parts = token.split('.');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(sessionId);
      expect(parts[1]).toHaveLength(32); // 16 bytes hex nonce
      expect(parts[2]).toHaveLength(64); // SHA-256 HMAC hex
    });

    it('generates unique tokens on subsequent calls for the same session ID', () => {
      const sessionId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      const token1 = service.generateToken(sessionId);
      const token2 = service.generateToken(sessionId);

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateToken', () => {
    const sessionId = 'session-uuid-1234';

    it('returns true when token is valid and matches expected sessionId', () => {
      const token = service.generateToken(sessionId);
      expect(service.validateToken(token, sessionId)).toBe(true);
    });

    it('returns false when token was issued for a different session (session-bound violation)', () => {
      const token = service.generateToken('session-uuid-A');
      expect(service.validateToken(token, 'session-uuid-B')).toBe(false);
    });

    it('returns false when token signature is tampered with', () => {
      const token = service.generateToken(sessionId);
      const parts = token.split('.');
      // Tamper with the signature
      const tampered = `${parts[0]}.${parts[1]}.${'f'.repeat(64)}`;
      expect(service.validateToken(tampered, sessionId)).toBe(false);
    });

    it('returns false for malformed or missing token strings', () => {
      expect(service.validateToken('', sessionId)).toBe(false);
      expect(service.validateToken(undefined, sessionId)).toBe(false);
      expect(service.validateToken('invalid.format', sessionId)).toBe(false);
      expect(service.validateToken('a.b.c.d', sessionId)).toBe(false);
    });
  });

  describe('validateOrigin', () => {
    it('returns true when Origin matches allowed origin in CORS whitelist', () => {
      expect(service.validateOrigin('http://localhost:5173')).toBe(true);
      expect(service.validateOrigin('https://aurel.restaurant')).toBe(true);
    });

    it('returns false when Origin is an untrusted third party domain', () => {
      expect(service.validateOrigin('https://evil-attacker.com')).toBe(false);
      expect(service.validateOrigin('http://localhost:8080')).toBe(false);
    });

    it('rejects literal "null" Origin header (e.g. from sandboxed iframes or data URLs)', () => {
      expect(service.validateOrigin('null')).toBe(false);
    });

    it('rejects subdomain and suffix attacks attempting to spoof allowed origins', () => {
      expect(service.validateOrigin('https://aurel.restaurant.attacker.com')).toBe(false);
      expect(service.validateOrigin('https://attacker-aurel.restaurant')).toBe(false);
      expect(service.validateOrigin('http://localhost:51730')).toBe(false);
      expect(service.validateOrigin('http://localhost:517')).toBe(false);
    });

    it('rejects requests when Origin and Referer disagree', () => {
      expect(
        service.validateOrigin('http://localhost:5173', 'https://attacker.com/malicious'),
      ).toBe(false);
      expect(service.validateOrigin('https://aurel.restaurant', 'http://localhost:5173/page')).toBe(
        false,
      );
    });

    it('accepts requests when both Origin and Referer are trusted and agree', () => {
      expect(
        service.validateOrigin('http://localhost:5173', 'http://localhost:5173/dashboard'),
      ).toBe(true);
      expect(
        service.validateOrigin('https://aurel.restaurant', 'https://aurel.restaurant/orders'),
      ).toBe(true);
    });

    it('evaluates Referer origin when Origin header is absent', () => {
      expect(service.validateOrigin(undefined, 'https://aurel.restaurant/cart')).toBe(true);
      expect(service.validateOrigin(undefined, 'https://attacker.site/phish')).toBe(false);
      expect(service.validateOrigin(undefined, 'malformed-url-string')).toBe(false);
    });

    it('permits requests when both Origin and Referer are absent (safe non-browser / direct clients)', () => {
      expect(service.validateOrigin(undefined, undefined)).toBe(true);
    });

    it('rejects comma-separated or duplicate Origin headers to prevent header smuggling bypass', () => {
      expect(service.validateOrigin('http://localhost:5173, http://localhost:5173')).toBe(false);
      expect(service.validateOrigin('http://localhost:5173, https://evil.com')).toBe(false);
      expect(service.validateOrigin(['http://localhost:5173', 'http://localhost:5173'])).toBe(
        false,
      );
    });

    it('rejects comma-separated or array Referer headers', () => {
      expect(
        service.validateOrigin(
          'http://localhost:5173',
          'http://localhost:5173/orders, https://evil.com',
        ),
      ).toBe(false);
      expect(
        service.validateOrigin('http://localhost:5173', [
          'http://localhost:5173',
          'http://localhost:5173',
        ]),
      ).toBe(false);
    });
  });
});
