import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { AppTokenAllowed, Auth } from '../common/decorators';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { PagesService } from '../pages/pages.service';
import { CreateSpaceDto, ListSpacesQuery, SetSpacePermissionsDto, UpdateSpaceDto } from './spaces.dto';
import { SpacesService } from './spaces.service';

/** Lesend auch für die Android-App (AppTokenAllowed, nur GET/HEAD) */
@AppTokenAllowed()
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly pages: PagesService,
  ) {}

  @Get()
  list(@Query() q: ListSpacesQuery, @Auth() ctx: AuthContext) {
    return this.spaces.list(ctx.user, q.status);
  }

  @Post()
  create(@Body() dto: CreateSpaceDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.spaces.create(dto, ctx, clientIp(req));
  }

  @Get(':key')
  get(@Param('key') key: string, @Auth() ctx: AuthContext) {
    return this.spaces.get(ctx.user, key);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSpaceDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.spaces.update(key, dto, ctx, clientIp(req));
  }

  @Get(':key/tree')
  tree(@Param('key') key: string, @Auth() ctx: AuthContext) {
    return this.pages.tree(ctx.user, key);
  }

  @Get(':key/trash')
  trash(@Param('key') key: string, @Auth() ctx: AuthContext) {
    return this.pages.trash(ctx.user, key);
  }

  @Get(':key/permissions')
  permissions(@Param('key') key: string, @Auth() ctx: AuthContext) {
    return this.spaces.permissionsOf(ctx.user, key);
  }

  @Put(':key/permissions')
  setPermissions(@Param('key') key: string, @Body() dto: SetSpacePermissionsDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.spaces.setPermissions(key, dto, ctx, clientIp(req));
  }
}
