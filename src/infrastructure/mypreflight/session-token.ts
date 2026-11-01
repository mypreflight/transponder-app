const TRANSPONDER = 'transponder';

export function isTransponderToken(token: string): boolean {
  const segments = token.split('.');
  const payload = segments[1];

  if (segments.length !== 3 || payload === undefined || payload === '') {
    return false;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    );

    return (
      typeof claims === 'object' &&
      claims !== null &&
      (claims as Record<string, unknown>).client === TRANSPONDER
    );
  } catch {
    return false;
  }
}
