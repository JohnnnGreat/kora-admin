import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    const interval = this.config.get<number>(
      'EMAIL_WORKER_INTERVAL_MS',
      10_000,
    );
    this.timer = setInterval(
      () => void this.email.processQueue().catch(() => undefined),
      interval,
    );
    void this.email.processQueue();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
