import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { SPACE_ROLES, type SpaceRole } from '@wiki/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Keine Steuerzeichen in Namen und Titeln */
// eslint-disable-next-line no-control-regex
export const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

export class CreateSpaceDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, {
    message: 'Der Schlüssel hat 2 bis 10 Zeichen: Buchstaben und Ziffern, beginnend mit einem Buchstaben.',
  })
  key: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARS, { message: 'Der Name enthält unzulässige Zeichen.' })
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** true (Standard): alle Benutzer dürfen bearbeiten; false: nur der Ersteller, weitere Rollen vergibt er selbst */
  @IsOptional()
  @IsBoolean()
  open?: boolean;
}

export class UpdateSpaceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARS, { message: 'Der Name enthält unzulässige Zeichen.' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class ListSpacesQuery {
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class SubjectRoleDto {
  @IsIn(['group', 'user'])
  type: 'group' | 'user';

  @IsUUID('all')
  id: string;

  @IsIn(SPACE_ROLES)
  role: SpaceRole;
}

export class SetSpacePermissionsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubjectRoleDto)
  entries: SubjectRoleDto[];
}
