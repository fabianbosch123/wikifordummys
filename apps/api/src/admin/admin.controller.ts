import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { AdminOnly, Auth } from '../common/decorators';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { CreateGroupDto, InviteUserDto, SetMembersDto, UpdateGroupDto, UpdateUserDto } from './admin.dto';
import { AdminService } from './admin.service';

class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_.]{1,64}$/)
  action?: string;
}

const uuid = new ParseUUIDPipe({ version: undefined });

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Post('users')
  invite(@Body() dto: InviteUserDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.inviteUser(dto, ctx, clientIp(req));
  }

  @Patch('users/:id')
  updateUser(@Param('id', uuid) id: string, @Body() dto: UpdateUserDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.updateUser(id, dto, ctx, clientIp(req));
  }

  @Post('users/:id/invite')
  @HttpCode(200)
  reinvite(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.resendInvitation(id, ctx, clientIp(req));
  }

  @Post('users/:id/reset-2fa')
  @HttpCode(204)
  reset2fa(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.resetTwoFactor(id, ctx, clientIp(req));
  }

  @Delete('users/:id/sessions')
  @HttpCode(204)
  revokeSessions(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.revokeSessions(id, ctx, clientIp(req));
  }

  @Get('groups')
  listGroups() {
    return this.admin.listGroups();
  }

  @Post('groups')
  createGroup(@Body() dto: CreateGroupDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.createGroup(dto, ctx, clientIp(req));
  }

  @Patch('groups/:id')
  @HttpCode(204)
  updateGroup(@Param('id', uuid) id: string, @Body() dto: UpdateGroupDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.updateGroup(id, dto, ctx, clientIp(req));
  }

  @Delete('groups/:id')
  @HttpCode(204)
  deleteGroup(@Param('id', uuid) id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.deleteGroup(id, ctx, clientIp(req));
  }

  @Put('groups/:id/members')
  @HttpCode(204)
  setMembers(@Param('id', uuid) id: string, @Body() dto: SetMembersDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    return this.admin.setMembers(id, dto.userIds, ctx, clientIp(req));
  }

  @Get('audit')
  audit(@Query() q: AuditQueryDto) {
    return this.admin.listAudit(q.limit ?? 100, q.before, q.action);
  }
}
