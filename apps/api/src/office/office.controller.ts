import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional } from 'class-validator';
import { Auth, Public } from '../common/decorators';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { OfficeService } from './office.service';

class EditorQuery {
  @IsOptional()
  @IsIn(['edit', 'view'])
  mode?: 'edit' | 'view';
}

@Controller()
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  /** Editor-Konfiguration für die Weboberfläche */
  @Get('attachments/:id/office')
  editor(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: EditorQuery, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.office.editorConfig(ctx, id, q.mode ?? 'view', clientIp(req));
  }

  /** Nur für den Editor-Server (Caddy sperrt den Pfad von außen); berechtigt ist der signierte Link */
  @Public()
  @Get('office/files/:token')
  async file(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.office.file(token);
    res.setHeader('Cache-Control', 'no-store');
    return file;
  }

  /** Rückruf des Editor-Servers nach dem Speichern; ohne Sitzung und CSRF-Token, dafür mit JWT-Signatur */
  @Public()
  @Post('office/callback')
  @HttpCode(200)
  callback(@Body() body: unknown, @Headers('authorization') authorization: string | undefined) {
    return this.office.callback(body, authorization);
  }
}
