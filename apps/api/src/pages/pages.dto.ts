import { Transform, Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { PAGE_TITLE_MAX_LENGTH } from '@wiki/shared';
import { NO_CONTROL_CHARS } from '../spaces/spaces.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class TitleAndContent {
  @Transform(trim)
  @IsString()
  @Length(1, PAGE_TITLE_MAX_LENGTH)
  @Matches(NO_CONTROL_CHARS, { message: 'Der Titel enthält unzulässige Zeichen.' })
  title: string;

  /** TipTap-JSON; Knoten, Marks und URLs prüft sanitizeDoc im Service (S6) */
  @IsObject()
  content: Record<string, unknown>;
}

export class CreatePageDto extends TitleAndContent {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,9}$/)
  spaceKey: string;

  @IsOptional()
  @IsUUID('all')
  parentId?: string;
}

export class UpdatePageDto extends TitleAndContent {
  /** Version, auf der die Änderung beruht; weicht sie ab, antwortet die API mit 409 */
  @IsInt()
  @Min(1)
  version: number;
}

export class MovePageDto {
  /** null = oberste Ebene des Spaces */
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all')
  parentId: string | null;

  /** Position unter den neuen Geschwistern, beginnend bei 0; zu große Werte hängen an */
  @IsInt()
  @Min(0)
  @Max(100_000)
  position: number;
}

export class DiffQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  to: number;
}
