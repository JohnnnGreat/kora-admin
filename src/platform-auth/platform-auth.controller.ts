import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import {
  PLATFORM_SESSION_COOKIE,
  PlatformSessionGuard,
} from '../platform-access/platform-session.guard';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAuthService } from './platform-auth.service';

@Controller('auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async login(
    @Body() dto: PlatformLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      this.requestContext(request),
    );
    response.cookie(PLATFORM_SESSION_COOKIE, result.rawToken, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    return { session: result.principal };
  }

  @Get('session')
  @UseGuards(PlatformSessionGuard)
  session(@CurrentPlatformPrincipal() principal: PlatformPrincipal) {
    return { session: principal };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard)
  async logout(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(principal, this.requestContext(request));
    response.clearCookie(PLATFORM_SESSION_COOKIE, this.cookieOptions());
    return { message: 'Signed out.' };
  }

  private requestContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE', true),
      sameSite: 'lax',
      path: '/',
    };
  }
}
