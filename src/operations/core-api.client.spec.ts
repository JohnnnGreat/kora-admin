import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CoreApiClient } from './core-api.client';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const configured = () =>
  new CoreApiClient(
    config({
      KORA_CORE_API_URL: 'https://core.example.com/',
      KORA_CORE_SERVICE_TOKEN: 'secret-token',
    }),
  );

const reply = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      body === undefined
        ? Promise.reject(new Error('no body'))
        : Promise.resolve(body),
  } as Response);

describe('CoreApiClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports whether it has an address and a token', () => {
    expect(configured().isConfigured()).toBe(true);
    expect(
      new CoreApiClient(
        config({ KORA_CORE_API_URL: 'https://x' }),
      ).isConfigured(),
    ).toBe(false);
    expect(new CoreApiClient(config({})).isConfigured()).toBe(false);
  });

  it('refuses to call out when it is not configured', async () => {
    const client = new CoreApiClient(config({}));
    await expect(
      client.get('/platform/operations/health'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the service token, joins the path to the address without a double slash', async () => {
    fetchMock.mockReturnValue(reply(200, { status: 'healthy' }));

    const body = await configured().get('/platform/operations/health');

    expect(body).toEqual({ status: 'healthy' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://core.example.com/platform/operations/health');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      'x-kora-platform-token': 'secret-token',
    });
  });

  it('posts a JSON body, or none at all', async () => {
    fetchMock.mockReturnValue(reply(200, { id: 'b1' }));
    const client = configured();

    await client.post('/platform/operations/backups/request', { reason: 'x' });
    await client.post('/platform/operations/queues/reports/retry-failed');

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const withBody = calls[0][1];
    const withoutBody = calls[1][1];
    expect(withBody.method).toBe('POST');
    expect(withBody.body).toBe(JSON.stringify({ reason: 'x' }));
    expect(withoutBody.body).toBeUndefined();
  });

  it("passes on the core's own explanation when it refuses", async () => {
    fetchMock.mockReturnValue(
      reply(400, { message: ['too soon', 'try later'] }),
    );
    await expect(configured().post('/x')).rejects.toThrow('too soon try later');

    fetchMock.mockReturnValue(reply(400, { message: 'No such job.' }));
    await expect(configured().post('/x')).rejects.toThrow('No such job.');
  });

  it('names the status when the core gives no explanation', async () => {
    fetchMock.mockReturnValue(reply(503, undefined));
    await expect(configured().get('/x')).rejects.toThrow(
      'The core Kora service answered 503.',
    );
  });

  it('turns a network failure or timeout into a bad gateway', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(configured().get('/x')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
