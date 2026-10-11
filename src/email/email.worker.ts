import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
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
    // Swallowing a tick's failure keeps the worker running rather than
    // crashing the process over one bad delivery, but a swallowed error
    // used to vanish with zero trace (see processQueue()'s own warning
    // below for the RESEND_API_KEY/EMAIL_FROM case this masked).
    const tick = () =>
      void this.email
        .processQueue()
        .catch((error: unknown) =>
          this.logger.error('processQueue tick failed', error),
        );
    this.timer = setInterval(tick, interval);
    tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
