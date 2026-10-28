import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AppTokenAllowed, Auth } from '../common/decorators';
import { AuthContext } from '../common/request-context';
import { SearchService } from './search.service';

export class SearchQuery {
  @IsString()
  @Length(1, 200)
  q: string;

  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,9}$/)
  space?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  offset?: number;
}

/** Lesend auch für die Android-App (AppTokenAllowed, nur GET/HEAD) */
@AppTokenAllowed()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@Query() query: SearchQuery, @Auth() ctx: AuthContext) {
    return this.search.search(ctx.user, query.q, { spaceKey: query.space, offset: query.offset });
  }
}
