import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { PlatformRequest } from './platform-request';

export const CurrentPlatformPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const principal = context
      .switchToHttp()
      .getRequest<PlatformRequest>().platformPrincipal;
    if (!principal) throw new UnauthorizedException('Not authenticated.');
    return principal;
  },
);
