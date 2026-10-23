import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UploadQuery {
  /** Original-Dateiname; wird für Anzeige und Download bereinigt */
  @IsString()
  @Length(1, 1000)
  filename: string;
}

export class VersionQuery {
  /** 1 = Bilder und PDF im Browser anzeigen (z. B. Zeichnungen auf Seiten) statt herunterzuladen */
  @IsOptional()
  @IsIn(['1'])
  inline?: '1';
}

export class DownloadQuery {
  /** 1 = immer herunterladen statt im Browser anzeigen */
  @IsOptional()
  @IsIn(['1'])
  download?: '1';
}
