import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './bootstrap/configure-application';

async function bootstrap() {
  // rawBody: true is what lets the Resend webhook verify Svix signatures
  // against the exact bytes received (see EmailService.verifyResendWebhook)
  // instead of a re-serialized copy that isn't guaranteed to match.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  configureApplication(app);
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
