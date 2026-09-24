import { isIP } from 'net';

/**
 * Normalizes an IP string by trimming whitespace and stripping IPv6-mapped IPv4 prefix (::ffff:).
 */
export function normalizeIp(ip?: string | null): string {
  if (!ip || typeof ip !== 'string') {
    return '';
  }

  let cleaned = ip.trim();

  // Strip IPv6-mapped IPv4 prefix (e.g., ::ffff:192.168.1.1 -> 192.168.1.1)
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.substring(7);
  }

  // Standardize loopback representation
  if (cleaned === '::1' || cleaned === '127.0.0.1') {
    return '127.0.0.1';
  }

  return cleaned.toLowerCase();
}

/**
 * Validates whether an entry is a valid single IPv4 or IPv6 address.
 */
export function isValidIp(ip?: string | null): boolean {
  if (!ip || typeof ip !== 'string') {
    return false;
  }
  const normalized = normalizeIp(ip);
  return isIP(normalized) !== 0;
}

/**
 * Validates whether an entry is a valid IPv4 or IPv6 CIDR notation (e.g. 203.0.113.0/24 or 2001:db8::/32).
 */
export function isValidCidr(cidr?: string | null): boolean {
  if (!cidr || typeof cidr !== 'string') {
    return false;
  }
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) {
    return false;
  }

  const [ipPart, bitsStr] = parts;
  const normalizedIp = normalizeIp(ipPart);
  const ipType = isIP(normalizedIp);

  if (ipType === 0) {
    return false;
  }

  if (!/^\d+$/.test(bitsStr)) {
    return false;
  }

  const bits = parseInt(bitsStr, 10);
  if (ipType === 4) {
    return bits >= 0 && bits <= 32;
  }
  if (ipType === 6) {
    return bits >= 0 && bits <= 128;
  }

  return false;
}

/**
 * Validates whether an entry is a valid single IP or CIDR block.
 */
export function isValidIpOrCidr(entry?: string | null): boolean {
  if (!entry || typeof entry !== 'string') {
    return false;
  }
  const trimmed = entry.trim();
  return isValidIp(trimmed) || isValidCidr(trimmed);
}

/**
 * Validates a comma, semicolon, or newline-separated list of allowed IPs and CIDR ranges.
 */
export function isValidAllowedIpList(pattern?: string | null): boolean {
  if (!pattern || typeof pattern !== 'string') {
    return false;
  }
  const entries = pattern.split(/[,;\n\r]+/).map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) {
    return false;
  }
  return entries.every((entry) => isValidIpOrCidr(entry));
}

function ipv4ToLong(ip: string): number {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0) >>>
    0
  );
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const prefix = parseInt(bitsStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const normalizedIp = normalizeIp(ip);
  const normalizedRange = normalizeIp(range);

  if (isIP(normalizedIp) !== 4 || isIP(normalizedRange) !== 4) return false;
  if (prefix === 0) return true;

  const mask = ((0xffffffff << (32 - prefix)) >>> 0);
  const ipLong = ipv4ToLong(normalizedIp);
  const rangeLong = ipv4ToLong(normalizedRange);

  return (ipLong & mask) === (rangeLong & mask);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const cleaned = normalizeIp(ip);
  if (cleaned.includes('.')) return null;

  const parts = cleaned.split('::');
  if (parts.length > 2) return null;

  let fullGroups: string[];
  if (parts.length === 2) {
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    fullGroups = [...head, ...middle, ...tail];
  } else {
    fullGroups = parts[0].split(':');
  }

  if (fullGroups.length !== 8) return null;

  let result = 0n;
  for (const group of fullGroups) {
    const val = BigInt(parseInt(group || '0', 16));
    result = (result << 16n) + val;
  }
  return result;
}

function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const prefix = parseInt(bitsStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 128) return false;

  const normalizedIp = normalizeIp(ip);
  const normalizedRange = normalizeIp(range);

  if (isIP(normalizedIp) !== 6 || isIP(normalizedRange) !== 6) return false;
  if (prefix === 0) return true;

  const ipInt = ipv6ToBigInt(normalizedIp);
  const rangeInt = ipv6ToBigInt(normalizedRange);
  if (ipInt === null || rangeInt === null) return false;

  const shift = 128n - BigInt(prefix);
  return (ipInt >> shift) === (rangeInt >> shift);
}

/**
 * Checks whether an incoming client IP matches an allowed IP pattern.
 * Supports:
 * - Exact IPv4 / IPv6 matches (with loopback normalization)
 * - CIDR notation (e.g. 203.0.113.0/24, 2001:db8::/32)
 * - Comma, semicolon, or newline-separated multiple allowed entries (e.g. "203.0.113.25, 198.51.100.0/24")
 */
export function isIpMatch(clientIp: string, allowedPattern: string): boolean {
  const normClient = normalizeIp(clientIp);
  if (!normClient || !allowedPattern) {
    return false;
  }

  const clientType = isIP(normClient);
  if (clientType === 0) {
    return false;
  }

  const entries = allowedPattern
    .split(/[,;\n\r]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry.includes('/')) {
      // CIDR matching
      const [baseIp] = entry.split('/');
      const baseType = isIP(normalizeIp(baseIp));

      if (clientType === 4 && baseType === 4 && isIpv4InCidr(normClient, entry)) {
        return true;
      }
      if (clientType === 6 && baseType === 6 && isIpv6InCidr(normClient, entry)) {
        return true;
      }
    } else {
      // Single IP exact match
      const normEntry = normalizeIp(entry);
      if (normClient === normEntry) {
        return true;
      }
    }
  }

  return false;
}
