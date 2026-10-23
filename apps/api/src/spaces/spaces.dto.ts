import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

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
