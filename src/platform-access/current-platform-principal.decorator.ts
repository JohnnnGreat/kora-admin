import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { PlatformRequest } from './platform-request';

export const CurrentPlatformPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const principal = request.platformPrincipal;
    // eslint-disable-next-line no-console
    console.log(
      '[DEBUG principal-decorator]',
      request.method,
      request.url,
      'hasPrincipal=',
      !!principal,
    );
    if (!principal) throw new UnauthorizedException('Not authenticated.');
    return principal;
  },
);
