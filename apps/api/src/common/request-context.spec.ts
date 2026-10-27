import { clientNet } from './request-context';

describe('clientNet', () => {
  it('fasst IPv6 zum /64 zusammen und lässt IPv4 einzeln', () => {
    expect(clientNet('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNet('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientNet('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(clientNet('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientNet('2001:0db8:00aa:0000::ffff')).toBe('2001:db8:aa:0::/64');
    expect(clientNet('unbekannt')).toBe('unbekannt');
  });
});
