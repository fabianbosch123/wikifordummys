import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { API_TOKEN_LIFETIMES_DAYS, API_TOKEN_NAME_MAX_LENGTH, API_TOKEN_SCOPES, type ApiAccessDto, type ApiTokenScope, type CreatedApiTokenDto, type MyApiTokensDto } from '@wiki/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';
import { AdminOnly, Auth } from '../common/decorators';
import { AuthContext, clientIp, userAgent, WikiRequest } from '../common/request-context';
import { NO_CONTROL_CHARS } from '../spaces/spaces.dto';
import { ApiTokensService } from './api-tokens.service';

const uuid = new ParseUUIDPipe({ version: undefined });

class CreateTokenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, API_TOKEN_NAME_MAX_LENGTH)
  @Matches(NO_CONTROL_CHARS, { message: 'Der Name enthält unzulässige Zeichen.' })
  name: string;

  @IsIn(API_TOKEN_SCOPES)
  scope: ApiTokenScope;

  @IsIn(API_TOKEN_LIFETIMES_DAYS)
  expiresInDays: number;

  @Matches(/^\d{6}$/, { message: 'Der Code besteht aus 6 Ziffern.' })
  code: string;
}

class ApiAccessSettingsDto {
  @IsBoolean()
  enabled: boolean;
}

/** Eigene API-Tokens für den MCP-Server (Claude) */
@Controller('me/tokens')
export class MyTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  list(@Auth() ctx: AuthContext): Promise<MyApiTokensDto> {
    return this.tokens.listOwn(ctx.user.id);
  }

  @Post()
  create(@Body() dto: CreateTokenDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest): Promise<CreatedApiTokenDto> {
    return this.tokens.create(ctx, dto, clientIp(req), userAgent(req));
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.tokens.revokeOwn(ctx, id, clientIp(req));
  }
}

/** MCP-Zugang ein- und ausschalten, Tokens aller Benutzer sehen und widerrufen */
@AdminOnly()
@Controller('admin/api-access')
export class ApiAccessController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  get(): Promise<ApiAccessDto> {
    return this.tokens.listAll();
  }

  @Put()
  async put(@Body() dto: ApiAccessSettingsDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest): Promise<ApiAccessDto> {
    await this.tokens.setEnabled(dto.enabled, ctx, clientIp(req));
    return this.tokens.listAll();
  }

  @Delete('tokens/:id')
  @HttpCode(204)
  revoke(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.tokens.revokeAny(ctx, id, clientIp(req));
  }
}
