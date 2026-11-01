import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, redact } from './logger';

describe('redact', () => {
  it('hides a device code, which is a credential until the sign-in ends', () => {
    expect(redact('{"deviceCode":"8aPgRni6cPqzGUjmZPq29KO9"}')).toBe(
      '{"deviceCode":"[redacted]"}',
    );
  });

  it('hides a bearer token', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.J9.abc-_123')).toBe(
      'Authorization: Bearer [redacted]',
    );
  });

  it('hides tokens and passwords in serialized payloads', () => {
    expect(
      redact('{"refreshToken":"abc123","password":"P@$$w0rd","other":"kept"}'),
    ).toBe(
      '{"refreshToken":"[redacted]","password":"[redacted]","other":"kept"}',
    );
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('published 42 reports for AAL4908')).toBe(
      'published 42 reports for AAL4908',
    );
  });
});

describe('Logger', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ft-logger-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes to the file it was given', () => {
    const path = join(directory, 'app.log');

    new Logger('info', path).info('wheels up');

    expect(existsSync(path)).toBe(true);
  });

  it('keeps talking to the screen when there is nowhere to write', () => {
    const lines: string[] = [];

    new Logger('info', null, 'app', (line) => lines.push(line)).info(
      'wheels up',
    );

    expect(lines[0]).toContain('wheels up');
    expect(directory).toBeTruthy();
  });
});
