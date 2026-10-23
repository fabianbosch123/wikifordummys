import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SMTP_SECURITY, type MailSettingsInput, type SmtpSecurity } from '@wiki/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Absender wie "wikifordummys <wiki@example.de>" oder nur die Adresse; keine Zeilenumbrüche (Header-Injection) */
export const MAIL_FROM_PATTERN = /^(?:[^<>\r\n"]{0,100}<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/;

export class MailSettingsDto implements MailSettingsInput {
  @Transform(trim)
  @IsString()
  @Matches(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9A-Fa-f:.]+\]?$/, {
    message: 'Bitte einen gültigen Servernamen oder eine IP-Adresse angeben.',
  })
  @MaxLength(253)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsIn(SMTP_SECURITY)
  security: SmtpSecurity;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(254)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @Transform(trim)
  @Matches(MAIL_FROM_PATTERN, { message: 'Absender bitte als "Name <adresse@example.de>" oder nur als Adresse angeben.' })
  from: string;

  @IsOptional()
  @IsBoolean()
  skipVerify?: boolean;
}

export class TestMailDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  to?: string;
}
