import type { Readable } from 'node:stream';
import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import type { AttachmentDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../spaces/permission.service';
import { userRef } from '../spaces/spaces.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { cleanFilename, contentDisposition, detectType, previewOf } from './file-type';

const include = { uploadedBy: { select: { id: true, displayName: true } } } as const;

export interface AttachmentDownload {
  file: StreamableFile;
  etag: string;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger('Anhänge');

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly storage: AttachmentStorageService,
    private readonly audit: AuditService,
  ) {}

  toDto(a: Attachment & { uploadedBy: { id: string; displayName: string } | null }): AttachmentDto {
    return {
      id: a.id,
      pageId: a.pageId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      preview: previewOf(a.mimeType),
      uploadedBy: userRef(a.uploadedBy),
      createdAt: a.createdAt.toISOString(),
      url: `/api/v1/attachments/${a.id}`,
    };
  }

  async list(user: AuthUser, pageId: string): Promise<AttachmentDto[]> {
    await this.permissions.requirePage(user, pageId, 'view');
    const rows = await this.prisma.attachment.findMany({ where: { pageId }, include, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => this.toDto(a));
  }

  /**
   * Speichert den Anfrage-Inhalt als Anhang. Die Rechte werden geprüft, bevor auch nur ein Byte gelesen wird.
   * Der angezeigte Typ ergibt sich allein aus dem Inhalt (S7).
   */
  async upload(pageId: string, rawFilename: string, declaredLength: number | null, body: Readable, ctx: AuthContext): Promise<AttachmentDto> {
    await this.permissions.requirePage(ctx.user, pageId, 'edit');
    if (declaredLength !== null && declaredLength > this.storage.maxBytes) throw Errors.tooLarge(this.storage.maxBytes / 1024 / 1024);
    const stored = await this.storage.store(body);
    if (stored.sizeBytes === 0) {
      await this.storage.remove([stored.storageKey]);
      throw Errors.badRequest('Die Datei ist leer.');
    }
    try {
      const created = await this.prisma.attachment.create({
        data: {
          pageId,
          filename: cleanFilename(rawFilename),
          mimeType: detectType(stored.head).mimeType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          uploadedById: ctx.user.id,
        },
        include,
      });
      return this.toDto(created);
    } catch (err) {
      // Seite inzwischen endgültig gelöscht o. Ä.: keine verwaiste Datei zurücklassen
      await this.storage.remove([stored.storageKey]);
      throw err;
    }
  }

  private async load(user: AuthUser, id: string, need: 'view' | 'edit') {
    const attachment = await this.prisma.attachment.findUnique({ where: { id }, include });
    if (!attachment) throw Errors.notFound();
    const access = await this.permissions.requirePage(user, attachment.pageId, need);
    return { attachment, access };
  }

  /**
   * Liefert die Datei mit Rechteprüfung aus. Nur Bilder und PDF werden inline angezeigt;
   * alles andere kommt als application/octet-stream mit Content-Disposition: attachment (S7).
   */
  async download(user: AuthUser, id: string, forceDownload: boolean): Promise<AttachmentDownload> {
    const { attachment } = await this.load(user, id, 'view');
    const inline = previewOf(attachment.mimeType) !== null && !forceDownload;
    const stream = this.storage.open(attachment.storageKey);
    // Datei fehlt auf der Platte: als 404 melden statt die Verbindung abzubrechen
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    }).catch((err) => {
      this.logger.error(`Datei zu Anhang ${id} fehlt: ${String(err)}`);
      throw Errors.notFound();
    });
    return {
      file: new StreamableFile(stream, {
        type: inline ? attachment.mimeType : 'application/octet-stream',
        disposition: contentDisposition(inline ? 'inline' : 'attachment', attachment.filename),
        length: attachment.sizeBytes,
      }),
      etag: `"${attachment.sha256}"`,
    };
  }

  async remove(id: string, ctx: AuthContext, ip: string): Promise<void> {
    const { attachment, access } = await this.load(ctx.user, id, 'edit');
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.remove([attachment.storageKey]);
    await this.audit.log({
      action: 'attachment.deleted',
      actorId: ctx.user.id,
      targetType: 'attachment',
      targetId: id,
      ip,
      details: { spaceKey: access.space.key, pageId: attachment.pageId, filename: attachment.filename },
    });
  }
}
