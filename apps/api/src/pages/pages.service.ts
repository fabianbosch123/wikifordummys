import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type Page } from '@prisma/client';
import {
  ContentError,
  docToLines,
  docToText,
  sanitizeDoc,
  TRASH_RETENTION_DAYS,
  type DocNode,
  type PageDiffDto,
  type PageDto,
  type PageVersionDto,
  type PageVersionSummaryDto,
  type TrashEntryDto,
  type TreeNodeDto,
} from '@wiki/shared';
import { diffArrays } from 'diff';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService, type SpaceAccess } from '../spaces/permission.service';
import { userRef } from '../spaces/spaces.service';
import type { CreatePageDto, MovePageDto, UpdatePageDto } from './pages.dto';

type Tx = Prisma.TransactionClient;

const userSelect = { select: { id: true, displayName: true } } as const;
const DAY_MS = 24 * 3600 * 1000;

const json = (doc: DocNode) => doc as unknown as Prisma.InputJsonValue;

/** Seiten-IDs aus dem materialisierten Pfad /a/b/c/ */
const pathIds = (path: string) => path.split('/').filter(Boolean);

function parseContent(raw: unknown): { content: DocNode; contentText: string } {
  try {
    const content = sanitizeDoc(raw);
    return { content, contentText: docToText(content) };
  } catch (err) {
    if (err instanceof ContentError) throw Errors.invalidContent(err.message);
    throw err;
  }
}

@Injectable()
export class PagesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Seiten');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lesen ----------

  private async toDto(page: Page, access: SpaceAccess): Promise<PageDto> {
    const full = await this.prisma.page.findUniqueOrThrow({
      where: { id: page.id },
      include: { createdBy: userSelect, updatedBy: userSelect },
    });
    const ancestorIds = pathIds(full.path).slice(0, -1);
    const ancestors = await this.prisma.page.findMany({ where: { id: { in: ancestorIds } }, select: { id: true, title: true } });
    const byId = new Map(ancestors.map((a) => [a.id, a]));
    const isHome = access.space.homePageId === full.id;
    return {
      id: full.id,
      spaceKey: access.space.key,
      parentId: full.parentId,
      title: full.title,
      content: full.content as unknown as DocNode,
      version: full.version,
      isHome,
      ancestors: ancestorIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      createdBy: userRef(full.createdBy),
      updatedBy: userRef(full.updatedBy),
      createdAt: full.createdAt.toISOString(),
      updatedAt: full.updatedAt.toISOString(),
      canEdit: access.canEdit,
      canDelete: access.canEdit && access.role === 'admin' && !isHome,
    };
  }

  async get(user: AuthUser, id: string): Promise<PageDto> {
    const { page, ...access } = await this.permissions.requirePage(user, id, 'view');
    return this.toDto(page, access);
  }

  async tree(user: AuthUser, key: string): Promise<TreeNodeDto[]> {
    const { space } = await this.permissions.requireSpace(user, key, 'view');
    return this.prisma.page.findMany({
      where: { spaceId: space.id, deletedAt: null },
      select: { id: true, parentId: true, title: true, position: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ---------- Hilfen für den Seitenbaum ----------

  /** Serialisiert alle Baumänderungen eines Spaces (Anlegen, Verschieben, Löschen) */
  private async lockSpace(tx: Tx, spaceId: string) {
    await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${spaceId}::uuid FOR UPDATE`;
  }

  private async lockPage(tx: Tx, pageId: string): Promise<Page> {
    await tx.$queryRaw`SELECT id FROM pages WHERE id = ${pageId}::uuid FOR UPDATE`;
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page || page.deletedAt) throw Errors.notFound();
    return page;
  }

  private async liveParent(tx: Tx, spaceId: string, parentId: string): Promise<Page> {
    const parent = await tx.page.findUnique({ where: { id: parentId } });
    // Fremde Spaces und gelöschte Seiten verhalten sich wie nicht vorhanden
    if (!parent || parent.spaceId !== spaceId || parent.deletedAt) throw Errors.badRequest('Die übergeordnete Seite existiert nicht.');
    return parent;
  }

  /** Ersetzt den Pfad-Anfang einer Seite und aller Unterseiten (auch gelöschter) */
  private async rebasePaths(tx: Tx, spaceId: string, oldPath: string, newPath: string) {
    await tx.$executeRaw`
      UPDATE pages SET path = ${newPath} || substr(path, ${oldPath.length + 1}::int)
      WHERE space_id = ${spaceId}::uuid AND path LIKE ${oldPath + '%'}`;
  }

  /** Lückenlose Positionen 0..n-1 für die Geschwister; optional mit einer Seite an fester Stelle */
  private async renumber(tx: Tx, spaceId: string, parentId: string | null, insert?: { id: string; position: number }) {
    const siblings = await tx.page.findMany({
      where: { spaceId, parentId, deletedAt: null, id: insert ? { not: insert.id } : undefined },
      select: { id: true, position: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    const ids = siblings.map((s) => s.id);
    if (insert) ids.splice(Math.min(insert.position, ids.length), 0, insert.id);
    const current = new Map(siblings.map((s) => [s.id, s.position]));
    for (const [position, id] of ids.entries()) {
      if (current.get(id) !== position) await tx.page.update({ where: { id }, data: { position } });
    }
  }

  // ---------- Anlegen und Speichern ----------

  async create(dto: CreatePageDto, ctx: AuthContext): Promise<PageDto> {
    const access = await this.permissions.requireSpace(ctx.user, dto.spaceKey, 'edit');
    const { content, contentText } = parseContent(dto.content);
    const spaceId = access.space.id;
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await this.lockSpace(tx, spaceId);
      const parent = dto.parentId ? await this.liveParent(tx, spaceId, dto.parentId) : null;
      const position = await tx.page.count({ where: { spaceId, parentId: parent?.id ?? null, deletedAt: null } });
      await tx.page.create({
        data: {
          id,
          spaceId,
          parentId: parent?.id ?? null,
          path: `${parent?.path ?? '/'}${id}/`,
          position,
          title: dto.title,
          content: json(content),
          contentText,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
          versions: { create: { version: 1, title: dto.title, content: json(content), contentText, authorId: ctx.user.id } },
        },
      });
    });
    return this.get(ctx.user, id);
  }

  /**
   * Speichert eine neue Version. Beruht die Änderung nicht auf der aktuellen Version,
   * gibt es 409 mit dem aktuellen Stand, damit nichts unbemerkt überschrieben wird.
   */
  async update(id: string, dto: UpdatePageDto, ctx: AuthContext): Promise<PageDto> {
    const { page: loaded, ...access } = await this.permissions.requirePage(ctx.user, id, 'edit');
    const { content, contentText } = parseContent(dto.content);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const page = await this.lockPage(tx, id);
      if (page.version !== dto.version) return 'conflict' as const;
      const unchanged = page.title === dto.title && isDeepStrictEqual(page.content, content);
      if (unchanged) return 'unchanged' as const;
      const version = page.version + 1;
      await tx.page.update({
        where: { id },
        data: { title: dto.title, content: json(content), contentText, version, updatedById: ctx.user.id },
      });
      await tx.pageVersion.create({
        data: { pageId: id, version, title: dto.title, content: json(content), contentText, authorId: ctx.user.id },
      });
      return 'saved' as const;
    });
    if (outcome === 'conflict') {
      throw Errors.conflict('Die Seite wurde inzwischen geändert.', { current: await this.toDto(loaded, access) });
    }
    return this.get(ctx.user, id);
  }

  // ---------- Verschieben ----------

  async move(id: string, dto: MovePageDto, ctx: AuthContext): Promise<PageDto> {
    const { page, space } = await this.permissions.requirePage(ctx.user, id, 'edit');
    if (space.homePageId === id) throw Errors.badRequest('Die Startseite eines Spaces kann nicht verschoben werden.');
    await this.prisma.$transaction(async (tx) => {
      await this.lockSpace(tx, space.id);
      const current = await this.lockPage(tx, page.id);
      const parent = dto.parentId ? await this.liveParent(tx, space.id, dto.parentId) : null;
      if (parent && parent.path.startsWith(current.path)) {
        throw Errors.badRequest('Eine Seite kann nicht unter sich selbst oder ihre Unterseiten verschoben werden.');
      }
      const newPath = `${parent?.path ?? '/'}${current.id}/`;
      if (newPath !== current.path) {
        await this.rebasePaths(tx, space.id, current.path, newPath);
        await tx.page.update({ where: { id: current.id }, data: { parentId: parent?.id ?? null } });
        await this.renumber(tx, space.id, current.parentId);
      }
      await this.renumber(tx, space.id, parent?.id ?? null, { id: current.id, position: dto.position });
    });
    return this.get(ctx.user, id);
  }

  // ---------- Löschen und Papierkorb ----------

  /** Verschiebt die Seite samt Unterseiten in den Papierkorb (30 Tage) */
  async remove(id: string, ctx: AuthContext, ip: string) {
    const { page, space } = await this.permissions.requirePage(ctx.user, id, 'admin');
    if (space.status !== 'active') throw Errors.spaceArchived();
    if (space.homePageId === id) throw Errors.badRequest('Die Startseite eines Spaces kann nicht gelöscht werden.');
    let count = 0;
    await this.prisma.$transaction(async (tx) => {
      await this.lockSpace(tx, space.id);
      const current = await this.lockPage(tx, page.id);
      ({ count } = await tx.page.updateMany({
        where: { spaceId: space.id, path: { startsWith: current.path }, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: ctx.user.id },
      }));
      await this.renumber(tx, space.id, current.parentId);
    });
    await this.audit.log({
      action: 'page.deleted',
      actorId: ctx.user.id,
      targetType: 'page',
      targetId: id,
      ip,
      details: { spaceKey: space.key, title: page.title, pages: count },
    });
  }

  async trash(user: AuthUser, key: string): Promise<TrashEntryDto[]> {
    const { space } = await this.permissions.requireSpace(user, key, 'admin');
    const deleted = await this.prisma.page.findMany({
      where: { spaceId: space.id, deletedAt: { not: null } },
      include: { deletedBy: userSelect },
      orderBy: { deletedAt: 'desc' },
    });
    const byId = new Map(deleted.map((p) => [p.id, p]));
    // Einträge sind die Seiten, die selbst gelöscht wurden; mitgelöschte Unterseiten zählen dazu
    const roots = deleted.filter((p) => !(p.parentId && byId.get(p.parentId)?.deletedAt?.getTime() === p.deletedAt!.getTime()));
    return roots.map((p) => ({
      id: p.id,
      title: p.title,
      deletedAt: p.deletedAt!.toISOString(),
      deletedBy: userRef(p.deletedBy),
      descendants: deleted.filter((d) => d.id !== p.id && d.path.startsWith(p.path) && d.deletedAt!.getTime() === p.deletedAt!.getTime()).length,
      purgeAt: new Date(p.deletedAt!.getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
    }));
  }

  /** Holt eine Seite samt mitgelöschten Unterseiten zurück; fehlt die Elternseite, landet sie oben im Space */
  async undelete(id: string, ctx: AuthContext, ip: string): Promise<PageDto> {
    const { page, space } = await this.permissions.requirePage(ctx.user, id, 'admin', { deleted: true });
    if (space.status !== 'active') throw Errors.spaceArchived();
    await this.prisma.$transaction(async (tx) => {
      await this.lockSpace(tx, space.id);
      const parent = page.parentId ? await tx.page.findUnique({ where: { id: page.parentId } }) : null;
      if (parent?.deletedAt?.getTime() === page.deletedAt!.getTime()) {
        throw Errors.badRequest('Diese Seite wurde mit ihrer Elternseite gelöscht; bitte die Elternseite wiederherstellen.');
      }
      await tx.page.updateMany({
        where: { spaceId: space.id, path: { startsWith: page.path }, deletedAt: page.deletedAt },
        data: { deletedAt: null, deletedById: null },
      });
      if (parent && !parent.deletedAt) {
        await this.renumber(tx, space.id, parent.id, { id: page.id, position: Number.MAX_SAFE_INTEGER });
      } else {
        const newPath = `/${page.id}/`;
        await this.rebasePaths(tx, space.id, page.path, newPath);
        await tx.page.update({ where: { id: page.id }, data: { parentId: null } });
        await this.renumber(tx, space.id, null, { id: page.id, position: Number.MAX_SAFE_INTEGER });
      }
    });
    await this.audit.log({
      action: 'page.restored',
      actorId: ctx.user.id,
      targetType: 'page',
      targetId: id,
      ip,
      details: { spaceKey: space.key, title: page.title },
    });
    return this.get(ctx.user, id);
  }

  async purgeTrash(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
    // Unterseiten und Versionen werden per Fremdschlüssel mitgelöscht
    const { count } = await this.prisma.page.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    return count;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => this.purgeTrash().catch((e) => this.logger.error(e));
    void run();
    this.timer = setInterval(run, DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Versionen ----------

  async versions(user: AuthUser, id: string): Promise<PageVersionSummaryDto[]> {
    await this.permissions.requirePage(user, id, 'view');
    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId: id },
      select: { version: true, title: true, createdAt: true, restoredFrom: true, author: userSelect },
      orderBy: { version: 'desc' },
    });
    return rows.map((v) => ({
      version: v.version,
      title: v.title,
      author: userRef(v.author),
      createdAt: v.createdAt.toISOString(),
      restoredFrom: v.restoredFrom,
    }));
  }

  private async loadVersion(pageId: string, version: number) {
    const row = await this.prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId, version } },
      include: { author: userSelect },
    });
    if (!row) throw Errors.notFound();
    return row;
  }

  async version(user: AuthUser, id: string, version: number): Promise<PageVersionDto> {
    await this.permissions.requirePage(user, id, 'view');
    const v = await this.loadVersion(id, version);
    return {
      pageId: id,
      version: v.version,
      title: v.title,
      content: v.content as unknown as DocNode,
      author: userRef(v.author),
      createdAt: v.createdAt.toISOString(),
      restoredFrom: v.restoredFrom,
    };
  }

  /** Zeilenweiser Vergleich zweier Versionen, eine Zeile je Absatz, Listenpunkt oder Tabellenzeile */
  async diff(user: AuthUser, id: string, from: number, to: number): Promise<PageDiffDto> {
    await this.permissions.requirePage(user, id, 'view');
    const [a, b] = await Promise.all([this.loadVersion(id, from), this.loadVersion(id, to)]);
    const changes = diffArrays(docToLines(a.content as unknown as DocNode), docToLines(b.content as unknown as DocNode));
    return {
      from,
      to,
      title: { from: a.title, to: b.title },
      lines: changes.flatMap((c) =>
        c.value.map((text) => ({ type: c.added ? ('added' as const) : c.removed ? ('removed' as const) : ('unchanged' as const), text })),
      ),
    };
  }

  /** Stellt eine ältere Version als neue, aktuelle Version wieder her; der Verlauf bleibt vollständig */
  async restoreVersion(id: string, version: number, ctx: AuthContext): Promise<PageDto> {
    await this.permissions.requirePage(ctx.user, id, 'edit');
    const old = await this.loadVersion(id, version);
    await this.prisma.$transaction(async (tx) => {
      const page = await this.lockPage(tx, id);
      const next = page.version + 1;
      const content = old.content as Prisma.InputJsonValue;
      await tx.page.update({
        where: { id },
        data: { title: old.title, content, contentText: old.contentText, version: next, updatedById: ctx.user.id },
      });
      await tx.pageVersion.create({
        data: { pageId: id, version: next, title: old.title, content, contentText: old.contentText, authorId: ctx.user.id, restoredFrom: version },
      });
    });
    return this.get(ctx.user, id);
  }
}
