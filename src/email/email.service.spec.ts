import { createHmac } from 'node:crypto';
import { EmailService } from './email.service';

function setup(configOverrides: Record<string, unknown> = {}) {
  const database = {} as never;
  const tenant = {} as never;
  const defaults: Record<string, unknown> = {
    EMAIL_UNSUBSCRIBE_SECRET: 'test-unsubscribe-secret',
    RESEND_WEBHOOK_SECRET: undefined,
    ADMIN_FRONTEND_URL: 'https://admin.example.com',
  };
  const values = { ...defaults, ...configOverrides };
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config: ${key}`);
      return value;
    },
  } as never;
  return new EmailService(database, tenant, config);
}

describe('EmailService unsubscribe tokens', () => {
  it('round-trips: a token it signs, it also verifies', () => {
    const service = setup();
    const token = service.unsubscribeToken('person@example.com');
    expect(token).toBeTruthy();
    expect(service.verifyUnsubscribeToken('person@example.com', token)).toBe(
      true,
    );
  });

  it('is case-insensitive on the email it was signed for', () => {
    const service = setup();
    const token = service.unsubscribeToken('Person@Example.com');
    expect(service.verifyUnsubscribeToken('person@example.com', token)).toBe(
      true,
    );
  });

  it('rejects a token signed for a different address', () => {
    const service = setup();
    const token = service.unsubscribeToken('person@example.com');
    expect(
      service.verifyUnsubscribeToken('someone-else@example.com', token),
    ).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const service = setup();
    const token = service.unsubscribeToken('person@example.com');
    const [timestamp] = token.split('.');
    expect(
      service.verifyUnsubscribeToken(
        'person@example.com',
        `${timestamp}.not-the-real-signature`,
      ),
    ).toBe(false);
  });

  it('rejects an expired token', () => {
    const service = setup();
    const ancientTimestamp = (Date.now() - 1000 * 60 * 60 * 24 * 400).toString(
      36,
    );
    const secret = 'test-unsubscribe-secret';
    const signature = createHmac('sha256', secret)
      .update(`person@example.com.${ancientTimestamp}`)
      .digest('base64url');
    expect(
      service.verifyUnsubscribeToken(
        'person@example.com',
        `${ancientTimestamp}.${signature}`,
      ),
    ).toBe(false);
  });

  it('refuses every token when no secret is configured', () => {
    const service = setup({ EMAIL_UNSUBSCRIBE_SECRET: undefined });
    expect(service.unsubscribeToken('person@example.com')).toBe('');
    expect(service.verifyUnsubscribeToken('person@example.com', '1.sig')).toBe(
      false,
    );
  });
});

describe('EmailService Resend webhook verification', () => {
  it('accepts unverified when no webhook secret is configured, with a warning', () => {
    const service = setup({ RESEND_WEBHOOK_SECRET: undefined });
    expect(
      service.verifyResendWebhook(Buffer.from('{}'), {
        id: undefined,
        timestamp: undefined,
        signature: undefined,
      }),
    ).toBe(true);
  });

  it('accepts a correctly signed payload', () => {
    const secret = 'whsec_dGVzdC1zZWNyZXQ='; // base64("test-secret")
    const service = setup({ RESEND_WEBHOOK_SECRET: secret });
    const body = Buffer.from(JSON.stringify({ type: 'email.delivered' }));
    const id = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = Buffer.from('dGVzdC1zZWNyZXQ=', 'base64');
    const signature = createHmac('sha256', key)
      .update(`${id}.${timestamp}.${body.toString('utf8')}`)
      .digest('base64');
    expect(
      service.verifyResendWebhook(body, {
        id,
        timestamp,
        signature: `v1,${signature}`,
      }),
    ).toBe(true);
  });

  it('rejects a payload with the wrong signature', () => {
    const service = setup({ RESEND_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=' });
    const body = Buffer.from(JSON.stringify({ type: 'email.delivered' }));
    expect(
      service.verifyResendWebhook(body, {
        id: 'msg_123',
        timestamp: Math.floor(Date.now() / 1000).toString(),
        signature: 'v1,bm90LXRoZS1yZWFsLXNpZ25hdHVyZQ==',
      }),
    ).toBe(false);
  });

  it('rejects a stale timestamp (older than 5 minutes)', () => {
    const secret = 'whsec_dGVzdC1zZWNyZXQ=';
    const service = setup({ RESEND_WEBHOOK_SECRET: secret });
    const body = Buffer.from(JSON.stringify({ type: 'email.delivered' }));
    const id = 'msg_123';
    const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const key = Buffer.from('dGVzdC1zZWNyZXQ=', 'base64');
    const signature = createHmac('sha256', key)
      .update(`${id}.${staleTimestamp}.${body.toString('utf8')}`)
      .digest('base64');
    expect(
      service.verifyResendWebhook(body, {
        id,
        timestamp: staleTimestamp,
        signature: `v1,${signature}`,
      }),
    ).toBe(false);
  });

  it('rejects when headers are missing', () => {
    const service = setup({ RESEND_WEBHOOK_SECRET: 'whsec_dGVzdA==' });
    expect(
      service.verifyResendWebhook(Buffer.from('{}'), {
        id: undefined,
        timestamp: undefined,
        signature: undefined,
      }),
    ).toBe(false);
  });
});

describe('EmailService.render (merge variables + unsubscribe footer)', () => {
  function render(service: EmailService, ...args: unknown[]) {
    return (
      service as unknown as {
        render: (...rest: unknown[]) => string;
      }
    ).render(...args);
  }

  it('substitutes {{name}}, {{email}} and {{organizationName}}', () => {
    const service = setup();
    const html = render(
      service,
      {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Hi {{name}} from {{organizationName}}, reach us at {{email}}.',
            },
          },
        ],
      },
      null,
      { email: 'person@example.com', name: 'Ada', organizationName: 'Acme' },
    );
    expect(html).toContain('Hi Ada from Acme, reach us at person@example.com.');
  });

  it('falls back to "there" for a missing name, and leaves unknown tags alone', () => {
    const service = setup();
    const html = render(
      service,
      {
        blocks: [
          { type: 'paragraph', data: { text: 'Hi {{name}}, {{notarealvar}}' } },
        ],
      },
      null,
      { email: 'person@example.com' },
    );
    expect(html).toContain('Hi there, {{notarealvar}}');
  });

  it('escapes HTML in a merge value so it cannot inject markup', () => {
    const service = setup();
    const html = render(
      service,
      { blocks: [{ type: 'paragraph', data: { text: 'Hi {{name}}' } }] },
      null,
      { email: 'a@example.com', name: '<script>alert(1)</script>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('appends a signed unsubscribe link when a secret is configured', () => {
    const service = setup();
    const html = render(
      service,
      { blocks: [{ type: 'paragraph', data: { text: 'Hello' } }] },
      null,
      { email: 'person@example.com' },
    );
    expect(html).toContain('https://admin.example.com/unsubscribe?email=');
    expect(html).toContain('Unsubscribe');
  });

  it('omits the unsubscribe footer when no secret is configured', () => {
    const service = setup({ EMAIL_UNSUBSCRIBE_SECRET: undefined });
    const html = render(
      service,
      { blocks: [{ type: 'paragraph', data: { text: 'Hello' } }] },
      null,
      { email: 'person@example.com' },
    );
    expect(html).not.toContain('Unsubscribe');
  });
});
