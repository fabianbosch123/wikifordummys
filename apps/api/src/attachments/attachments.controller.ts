import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../common/decorators';
import { Errors } from '../common/errors';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { DownloadQuery, UploadQuery, VersionQuery } from './attachments.dto';
import { AttachmentDownload, AttachmentsService } from './attachments.service';

const uuid = new ParseUUIDPipe({ version: undefined });

/** Ohne Datei hat der Browser den Stand schon: 304 ohne Inhalt (Nest schreibt ihn sonst nie, auch nicht bei passendem ETag) */
function sendDownload(res: Response, { file, etag }: AttachmentDownload, cacheControl: string) {
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  if (file) return file;
  res.status(304);
  return undefined;
}

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Content-Type und Länge prüfen wie beim Hochladen; liefert die angekündigte Länge */
  private octetStream(req: WikiRequest): number | null {
    // Andere Typen hätte ein Body-Parser schon gelesen oder sie sind nicht vorgesehen
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') {
      throw Errors.badRequest('Dateien bitte als application/octet-stream senden.', 'UNSUPPORTED_MEDIA_TYPE');
    }
    const length = req.headers['content-length'];
    return length ? Number(length) : null;
  }

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
    return this.attachments.upload(id, q.filename, this.octetStream(req), req, ctx);
  }

  /** Neue Fassung eines Anhangs hochladen (z. B. eine bearbeitete Zeichnung); Anfrage-Inhalt wie beim Hochladen */
  @Post('attachments/:id/versions')
  uploadVersion(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.attachments.uploadVersion(id, this.octetStream(req), req, ctx);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', uuid) id: string,
    @Query() q: DownloadQuery,
    @Auth() ctx: AuthContext,
    @Req() req: WikiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Die aktuelle Fassung kann sich ändern: jedes Mal nachfragen, bei gleichem Stand kommt 304
    const download = await this.attachments.download(ctx.user, id, q.download === '1', req.headers['if-none-match']);
    return sendDownload(res, download, 'private, no-cache');
  }

  @Get('attachments/:id/versions')
  versions(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.attachments.versions(ctx.user, id);
  }

  @Get('attachments/:id/versions/:version')
  async downloadVersion(
    @Param('id', uuid) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Query() q: VersionQuery,
    @Auth() ctx: AuthContext,
    @Req() req: WikiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Eine Fassung ändert sich nie (Zeichnungen auf Seiten verweisen auf sie): darf im Browser bleiben
    const download = await this.attachments.downloadVersion(ctx.user, id, version, q.inline === '1', req.headers['if-none-match']);
    return sendDownload(res, download, 'private, max-age=31536000, immutable');
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.attachments.remove(id, ctx, clientIp(req));
  }
}
