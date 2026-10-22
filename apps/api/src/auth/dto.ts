import { PASSWORD_MAX_LENGTH } from '@wiki/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class CodeDto {
  /** 6-stelliger TOTP-Code oder Wiederherstellungscode */
  @Transform(trim)
  @IsString()
  @Length(6, 20)
  code: string;
}

export class TotpCodeDto {
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Der Code besteht aus 6 Ziffern.' })
  code: string;
}

export class AcceptInviteDto {
  @IsString()
  @Length(20, 100)
  token: string;

  /** Policy wird im Service geprüft (S1), hier nur Obergrenze gegen sehr lange Eingaben */
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  displayName?: string;
}

export class ForgotPasswordDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 100)
  token: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
