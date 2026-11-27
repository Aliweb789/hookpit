import { isBlockedAddress } from './ip-guard';

describe('isBlockedAddress (SSRF guard)', () => {
  describe('blocks internal IPv4 addresses', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback range'],
      ['0.0.0.0', 'unspecified'],
      ['10.0.0.1', 'private 10/8'],
      ['10.255.255.255', 'private 10/8 end'],
      ['172.16.0.1', 'private 172.16/12'],
      ['172.31.255.255', 'private 172.16/12 end'],
      ['192.168.1.1', 'private 192.168/16'],
      ['169.254.169.254', 'cloud metadata service'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['198.18.0.1', 'benchmarking range'],
      ['224.0.0.1', 'multicast'],
      ['240.0.0.1', 'reserved'],
      ['255.255.255.255', 'broadcast'],
    ])('%s (%s)', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  });

  describe('allows normal public IPv4 addresses', () => {
    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.15.255.255', // just below 172.16/12
      '172.32.0.1', // just above 172.16/12
      '11.0.0.1',
      '192.169.0.1',
    ])('%s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
  });

  describe('blocks internal IPv6 addresses', () => {
    it.each([
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fc00::1', 'unique local'],
      ['fd12:3456:789a::1', 'unique local'],
      ['fe80::1', 'link-local'],
      ['fe80::1%eth0', 'link-local with zone id'],
      ['ff02::1', 'multicast'],
      ['2001:db8::1', 'documentation range'],
    ])('%s (%s)', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  });

  describe('blocks IPv6 forms that hide an internal IPv4 address', () => {
    it.each([
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
      ['::ffff:7f00:1', 'IPv4-mapped loopback, hex form'],
      ['::ffff:169.254.169.254', 'IPv4-mapped metadata service'],
      ['::ffff:10.0.0.1', 'IPv4-mapped private'],
      ['64:ff9b::7f00:1', 'NAT64 loopback'],
      ['0:0:0:0:0:ffff:192.168.0.1', 'long form mapped private'],
    ])('%s (%s)', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  });

  describe('allows public IPv6 addresses', () => {
    it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('%s', (ip) =>
      expect(isBlockedAddress(ip)).toBe(false),
    );
  });

  describe('fails closed on anything that is not a valid IP', () => {
    it.each(['', 'localhost', 'not-an-ip', '999.1.1.1', '1.2.3', '1:2:3:4:5:6:7:8:9', ':::'])(
      '%p',
      (value) => expect(isBlockedAddress(value)).toBe(true),
    );
  });
});
