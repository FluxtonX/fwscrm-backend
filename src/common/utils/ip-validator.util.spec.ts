import {
  isValidIp,
  isValidCidr,
  isValidIpOrCidr,
  isValidAllowedIpList,
  normalizeIp,
  isIpMatch,
} from './ip-validator.util';

describe('ip-validator.util', () => {
  describe('normalizeIp', () => {
    it('should trim whitespace', () => {
      expect(normalizeIp('  203.0.113.25  ')).toBe('203.0.113.25');
    });

    it('should strip IPv6-mapped IPv4 prefix (::ffff:)', () => {
      expect(normalizeIp('::ffff:203.0.113.25')).toBe('203.0.113.25');
    });

    it('should standardize loopback addresses', () => {
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
    });

    it('should handle null/empty values safely', () => {
      expect(normalizeIp(null)).toBe('');
      expect(normalizeIp(undefined)).toBe('');
      expect(normalizeIp('')).toBe('');
    });
  });

  describe('isValidIp', () => {
    it('should accept valid IPv4', () => {
      expect(isValidIp('203.0.113.25')).toBe(true);
      expect(isValidIp('192.168.1.1')).toBe(true);
      expect(isValidIp('127.0.0.1')).toBe(true);
    });

    it('should accept valid IPv6', () => {
      expect(isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      expect(isValidIp('::1')).toBe(true);
    });

    it('should reject malformed or arbitrary strings', () => {
      expect(isValidIp('invalid-ip')).toBe(false);
      expect(isValidIp('999.999.999.999')).toBe(false);
      expect(isValidIp('203.0.113.25.1')).toBe(false);
      expect(isValidIp('')).toBe(false);
      expect(isValidIp(null)).toBe(false);
    });
  });

  describe('isValidCidr', () => {
    it('should accept valid IPv4 CIDR blocks', () => {
      expect(isValidCidr('203.0.113.0/24')).toBe(true);
      expect(isValidCidr('10.0.0.0/8')).toBe(true);
      expect(isValidCidr('192.168.1.50/32')).toBe(true);
      expect(isValidCidr('0.0.0.0/0')).toBe(true);
    });

    it('should accept valid IPv6 CIDR blocks', () => {
      expect(isValidCidr('2001:db8::/32')).toBe(true);
      expect(isValidCidr('2001:db8:a0b:12f0::/64')).toBe(true);
      expect(isValidCidr('::/0')).toBe(true);
    });

    it('should reject invalid CIDR prefixes or formats', () => {
      expect(isValidCidr('203.0.113.0/33')).toBe(false);
      expect(isValidCidr('203.0.113.0/-1')).toBe(false);
      expect(isValidCidr('203.0.113.0/abc')).toBe(false);
      expect(isValidCidr('203.0.113.0')).toBe(false);
      expect(isValidCidr('invalid-ip/24')).toBe(false);
    });
  });

  describe('isValidAllowedIpList', () => {
    it('should validate single IP or CIDR', () => {
      expect(isValidAllowedIpList('203.0.113.25')).toBe(true);
      expect(isValidAllowedIpList('203.0.113.0/24')).toBe(true);
    });

    it('should validate comma-separated and newline-separated lists', () => {
      expect(isValidAllowedIpList('203.0.113.25, 198.51.100.0/24, 10.0.0.1')).toBe(true);
      expect(isValidAllowedIpList('203.0.113.25;\n198.51.100.0/24')).toBe(true);
    });

    it('should reject list containing any invalid entry', () => {
      expect(isValidAllowedIpList('203.0.113.25, not-an-ip')).toBe(false);
      expect(isValidAllowedIpList('')).toBe(false);
      expect(isValidAllowedIpList(null)).toBe(false);
    });
  });

  describe('isIpMatch', () => {
    it('should return true for matching single IPs', () => {
      expect(isIpMatch('203.0.113.25', '203.0.113.25')).toBe(true);
    });

    it('should return true when IPv6-mapped IPv4 matches IPv4', () => {
      expect(isIpMatch('::ffff:203.0.113.25', '203.0.113.25')).toBe(true);
    });

    it('should return false for different IPs', () => {
      expect(isIpMatch('198.51.100.10', '203.0.113.25')).toBe(false);
    });

    it('should match loopback variants', () => {
      expect(isIpMatch('::1', '127.0.0.1')).toBe(true);
      expect(isIpMatch('127.0.0.1', '::1')).toBe(true);
    });

    it('should correctly match IPv4 CIDR ranges', () => {
      expect(isIpMatch('203.0.113.45', '203.0.113.0/24')).toBe(true);
      expect(isIpMatch('203.0.113.1', '203.0.113.0/24')).toBe(true);
      expect(isIpMatch('203.0.114.1', '203.0.113.0/24')).toBe(false);
      expect(isIpMatch('10.25.100.1', '10.0.0.0/8')).toBe(true);
      expect(isIpMatch('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('should match multiple comma-separated entries', () => {
      const allowed = '198.51.100.5, 203.0.113.0/24, 192.168.1.1';
      expect(isIpMatch('198.51.100.5', allowed)).toBe(true);
      expect(isIpMatch('203.0.113.99', allowed)).toBe(true);
      expect(isIpMatch('192.168.1.1', allowed)).toBe(true);
      expect(isIpMatch('8.8.8.8', allowed)).toBe(false);
    });
  });
});

