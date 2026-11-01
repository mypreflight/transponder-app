import { isTransponderToken } from './session-token';

function part(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(claims: unknown): string {
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`;
}

const CLAIMS = {
  sub: 'a3c1f2d4-6b7e-4f8a-9c0d-1e2f3a4b5c6d',
  session: 'f0e1d2c3-b4a5-4968-8776-655443322110',
  type: 'refresh',
};

describe('isTransponderToken', () => {
  it('keeps a token the device sign-in issued to the Transponder', () => {
    expect(
      isTransponderToken(token({ ...CLAIMS, client: 'transponder' })),
    ).toBe(true);
  });

  it('refuses a token from the password sign-in, which names no client', () => {
    expect(isTransponderToken(token(CLAIMS))).toBe(false);
  });

  it('refuses a token issued to the browser', () => {
    expect(isTransponderToken(token({ ...CLAIMS, client: 'web' }))).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a bare word', 'refresh-1'],
    ['two segments', `${part({ alg: 'ES256' })}.${part(CLAIMS)}`],
    ['four segments', `${token({ ...CLAIMS, client: 'transponder' })}.extra`],
    ['an empty payload', `${part({ alg: 'ES256' })}..c2lnbmF0dXJl`],
    ['a payload that is not JSON', `${part({ alg: 'ES256' })}.bm90IGpzb24.sig`],
    ['a payload that is not an object', token('transponder')],
    ['a null payload', token(null)],
  ])('refuses %s', (_name, value) => {
    expect(isTransponderToken(value)).toBe(false);
  });
});
