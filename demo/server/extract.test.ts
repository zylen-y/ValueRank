import { describe, expect, it } from 'vitest';
import { isPublicAddress, validateUrl } from './extract.ts';

// Pure tests only: no DNS lookups, HTTP requests, or model calls.
describe('public-address classification', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.0.2.1',
    '198.18.0.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', 'fc00::1', 'fd00::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1',
    'not-an-ip', '',
  ])('rejects private, special-use, or invalid address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts public unicast %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('URL validation before DNS', () => {
  it.each([
    'file:///etc/passwd', 'ftp://example.com/file', 'javascript:alert(1)', 'data:text/plain,hello',
    'https://user:password@example.com/article', 'https://user@example.com/article',
    'https://example.com:3000/article', 'http://example.com:22/',
    'http://localhost/', 'http://foo.localhost/', 'http://printer.local/', 'http://metadata.google.internal/',
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
    '//example.com/relative', 'not a URL',
  ])('rejects unsupported, credentialed, or private URL %s', (url) => {
    expect(() => validateUrl(url)).toThrow();
  });

  it.each([
    'https://docs.typesafe.ai/models', 'http://example.com/article',
    'https://example.com:443/path?topic=ranking', 'http://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])('permits ordinary public syntax %s', (url) => {
    expect(validateUrl(url)).toBeInstanceOf(URL);
  });
});
