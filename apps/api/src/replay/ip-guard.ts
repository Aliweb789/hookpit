import { isIPv4, isIPv6 } from 'node:net';

// IPv4 ranges a public replay must never reach: [network address, prefix bits].
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes the cloud metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay (deprecated)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function v4ToNumber(ip: string): number {
  const [a, b, c, d] = ip.split('.').map(Number);
  return a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d;
}

function isBlockedV4(ip: string): boolean {
  const n = v4ToNumber(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const start = v4ToNumber(base);
    return n >= start && n < start + 2 ** (32 - bits);
  });
}

// Expand any valid IPv6 text form into its 8 numeric 16-bit groups.
// Returns null when the text is not a valid IPv6 address.
function expandV6(input: string): number[] | null {
  let ip = input.split('%')[0].toLowerCase(); // drop a zone id like %eth0
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    // embedded IPv4 such as ::ffff:127.0.0.1 -> convert to two hex groups
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    ip = `${ip.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * True when connecting to this address could reach an internal or special
 * network. Anything that is not a valid IP also returns true (fail closed).
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return isBlockedV4(address);
  if (!isIPv6(address)) return true; // not an IP at all: refuse

  const g = expandV6(address);
  if (!g) return true;

  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, includes :: and ::1)
  if (firstFiveZero && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedV4(v4FromGroups(g[6], g[7]));
  }
  // 64:ff9b::/96 (NAT64) embeds an IPv4 address in the last 32 bits
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedV4(v4FromGroups(g[6], g[7]));
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}
