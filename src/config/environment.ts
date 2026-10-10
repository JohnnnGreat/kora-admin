export type AdminEnvironment = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  TENANT_DATABASE_URL?: string;
  ADMIN_FRONTEND_URL: string;
  SESSION_TTL_HOURS: number;
  COOKIE_SECURE: boolean;
  KORA_CORE_API_URL?: string;
  KORA_CORE_SERVICE_TOKEN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = optionalString(source[key], '', key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function optionalString(value: unknown, fallback: string, key: string) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  return value.trim();
}

function parseUrl(value: string, key: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
}

function parseOrigin(value: string, key: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${key} must be a valid URL origin.`);
  }
}

function positiveInteger(value: unknown, fallback: number, key: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Boolean environment values must be true or false.');
}

export function validateEnvironment(
  source: Record<string, unknown>,
): AdminEnvironment & Record<string, unknown> {
  const nodeEnvironment = optionalString(
    source.NODE_ENV,
    'development',
    'NODE_ENV',
  );
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const tenantDatabaseUrl = optionalString(
    source.TENANT_DATABASE_URL,
    '',
    'TENANT_DATABASE_URL',
  );
  const coreApiUrl = optionalString(
    source.KORA_CORE_API_URL,
    '',
    'KORA_CORE_API_URL',
  );
  const coreServiceToken = optionalString(
    source.KORA_CORE_SERVICE_TOKEN,
    '',
    'KORA_CORE_SERVICE_TOKEN',
  );
  const resendApiKey = optionalString(
    source.RESEND_API_KEY,
    '',
    'RESEND_API_KEY',
  );
  const emailFrom = optionalString(source.EMAIL_FROM, '', 'EMAIL_FROM');
  if (Boolean(resendApiKey) !== Boolean(emailFrom)) {
    throw new Error(
      'RESEND_API_KEY and EMAIL_FROM must be configured together.',
    );
  }
  if (Boolean(coreApiUrl) !== Boolean(coreServiceToken)) {
    throw new Error(
      'KORA_CORE_API_URL and KORA_CORE_SERVICE_TOKEN must be configured together.',
    );
  }
  return {
    ...source,
    NODE_ENV: nodeEnvironment as AdminEnvironment['NODE_ENV'],
    PORT: positiveInteger(source.PORT, 3006, 'PORT'),
    DATABASE_URL: parseUrl(
      requiredString(source, 'DATABASE_URL'),
      'DATABASE_URL',
    ),
    ...(tenantDatabaseUrl
      ? {
          TENANT_DATABASE_URL: parseUrl(
            tenantDatabaseUrl,
            'TENANT_DATABASE_URL',
          ),
        }
      : {}),
    ...(coreApiUrl
      ? {
          KORA_CORE_API_URL: parseUrl(coreApiUrl, 'KORA_CORE_API_URL').replace(
            /\/$/,
            '',
          ),
          KORA_CORE_SERVICE_TOKEN: coreServiceToken,
        }
      : {}),
    ...(resendApiKey
      ? { RESEND_API_KEY: resendApiKey, EMAIL_FROM: emailFrom }
      : {}),
    ADMIN_FRONTEND_URL: parseOrigin(
      optionalString(
        source.ADMIN_FRONTEND_URL,
        'http://localhost:5176',
        'ADMIN_FRONTEND_URL',
      ),
      'ADMIN_FRONTEND_URL',
    ),
    SESSION_TTL_HOURS: positiveInteger(
      source.SESSION_TTL_HOURS,
      12,
      'SESSION_TTL_HOURS',
    ),
    COOKIE_SECURE: booleanValue(
      source.COOKIE_SECURE,
      nodeEnvironment === 'production',
    ),
  };
}
