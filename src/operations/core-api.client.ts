import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The admin app's way of asking the core Kora service how it is doing. Same
// address and service token as core provisioning (KORA_CORE_API_URL and
// KORA_CORE_SERVICE_TOKEN); the core accepts the token only on its
// /platform/* routes, so it opens nothing else.
@Injectable()
export class CoreApiClient {
  private readonly coreUrl?: string;
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.coreUrl = config.get<string>('KORA_CORE_API_URL')?.replace(/\/$/, '');
    this.token = config.get<string>('KORA_CORE_SERVICE_TOKEN');
  }

  isConfigured() {
    return Boolean(this.coreUrl && this.token);
  }

  get<T>(path: string, timeoutMs = 15_000) {
    return this.request<T>(path, { method: 'GET' }, timeoutMs);
  }

  post<T>(path: string, body?: unknown, timeoutMs = 15_000) {
    return this.request<T>(
      path,
      {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.coreUrl || !this.token) {
      throw new ServiceUnavailableException(
        'The core Kora service is not configured.',
      );
    }
    let response: Response;
    try {
      response = await fetch(`${this.coreUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'x-kora-platform-token': this.token,
        },
      });
    } catch {
      throw new BadGatewayException(
        'The core Kora service could not be reached.',
      );
    }
    const body = (await response.json().catch(() => null)) as
      (T & { message?: string | string[] }) | null;
    if (!response.ok) {
      const message = Array.isArray(body?.message)
        ? body.message.join(' ')
        : body?.message;
      throw new BadGatewayException(
        message || `The core Kora service answered ${response.status}.`,
      );
    }
    return body as T;
  }
}
