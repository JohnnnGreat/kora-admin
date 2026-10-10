import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('normalizes typed configuration values', () => {
    const result = validateEnvironment({
      NODE_ENV: 'production',
      PORT: '3006',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/admin',
      ADMIN_FRONTEND_URL: 'https://admin.koraerp.com/path',
      SESSION_TTL_HOURS: '8',
      COOKIE_SECURE: 'true',
    });

    expect(result).toMatchObject({
      NODE_ENV: 'production',
      PORT: 3006,
      ADMIN_FRONTEND_URL: 'https://admin.koraerp.com',
      SESSION_TTL_HOURS: 8,
      COOKIE_SECURE: true,
    });
  });

  it('rejects a missing platform database URL', () => {
    expect(() => validateEnvironment({})).toThrow('DATABASE_URL is required.');
  });

  it('rejects an invalid tenant database URL', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://localhost/admin',
        TENANT_DATABASE_URL: 'not-a-url',
      }),
    ).toThrow('TENANT_DATABASE_URL must be a valid URL.');
  });
});
