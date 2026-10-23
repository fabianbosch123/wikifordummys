import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../common/decorators';
import { Errors } from '../common/errors';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { DownloadQuery, UploadQuery } from './attachments.dto';
import { AttachmentsService } from './attachments.service';

const uuid = new ParseUUIDPipe({ version: undefined });

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('pages/:id/attachments')
  list(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.attachments.list(ctx.user, id);
  }

  /**
   * Hochladen: Der Anfrage-Inhalt ist die Datei selbst (Content-Type application/octet-stream),
   * der Dateiname steht im Parameter filename. So wird die Datei direkt auf die Platte gestreamt.
   */
  @Post('pages/:id/attachments')
  upload(@Param('id', uuid) id: string, @Query() q: UploadQuery, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    // Andere Typen hätte ein Body-Parser schon gelesen oder sie sind nicht vorgesehen
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') {
      throw Errors.badRequest('Dateien bitte als application/octet-stream senden.', 'UNSUPPORTED_MEDIA_TYPE');
    }
    const length = req.headers['content-length'];
    return this.attachments.upload(id, q.filename, length ? Number(length) : null, req, ctx);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', uuid) id: string,
    @Query() q: DownloadQuery,
    @Auth() ctx: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, etag } = await this.attachments.download(ctx.user, id, q.download === '1');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    return file;
  }

  @Get('attachments/:id/versions')
  versions(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.attachments.versions(ctx.user, id);
  }

  @Get('attachments/:id/versions/:version')
  async downloadVersion(
    @Param('id', uuid) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Auth() ctx: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, etag } = await this.attachments.downloadVersion(ctx.user, id, version);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    return file;
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.attachments.remove(id, ctx, clientIp(req));
  }
}
