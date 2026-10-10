import type { Request } from 'express';
import type { PlatformPrincipal } from './platform-principal';

export type PlatformRequest = Request & {
  platformPrincipal?: PlatformPrincipal;
};
