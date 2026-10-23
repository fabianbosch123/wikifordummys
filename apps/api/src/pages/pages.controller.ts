import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Auth } from '../common/decorators';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { CreatePageDto, DiffQuery, MovePageDto, SetRestrictionsDto, UpdatePageDto } from './pages.dto';
import { PagesService } from './pages.service';
import { RestrictionsService } from './restrictions.service';

const uuid = new ParseUUIDPipe({ version: undefined });

@Controller('pages')
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly restrictions: RestrictionsService,
  ) {}

  @Post()
  create(@Body() dto: CreatePageDto, @Auth() ctx: AuthContext) {
    return this.pages.create(dto, ctx);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.pages.get(ctx.user, id);
  }

  @Put(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdatePageDto, @Auth() ctx: AuthContext) {
    return this.pages.update(id, dto, ctx);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.pages.remove(id, ctx, clientIp(req));
  }

  @Post(':id/undelete')
  @HttpCode(200)
  undelete(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.pages.undelete(id, ctx, clientIp(req));
  }

  @Post(':id/move')
  @HttpCode(200)
  move(@Param('id', uuid) id: string, @Body() dto: MovePageDto, @Auth() ctx: AuthContext) {
    return this.pages.move(id, dto, ctx);
  }

  @Get(':id/versions')
  versions(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.pages.versions(ctx.user, id);
  }

  @Get(':id/versions/:version')
  version(@Param('id', uuid) id: string, @Param('version', ParseIntPipe) version: number, @Auth() ctx: AuthContext) {
    return this.pages.version(ctx.user, id, version);
  }

  @Get(':id/diff')
  diff(@Param('id', uuid) id: string, @Query() q: DiffQuery, @Auth() ctx: AuthContext) {
    return this.pages.diff(ctx.user, id, q.from, q.to);
  }

  @Post(':id/restore/:version')
  @HttpCode(200)
  restore(@Param('id', uuid) id: string, @Param('version', ParseIntPipe) version: number, @Auth() ctx: AuthContext) {
    return this.pages.restoreVersion(id, version, ctx);
  }

  @Get(':id/restrictions')
  getRestrictions(@Param('id', uuid) id: string, @Auth() ctx: AuthContext) {
    return this.restrictions.get(ctx.user, id);
  }

  @Put(':id/restrictions')
  setRestrictions(@Param('id', uuid) id: string, @Body() dto: SetRestrictionsDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.restrictions.set(id, dto, ctx, clientIp(req));
  }
}
