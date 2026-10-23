import { Controller, Get, Inject } from '@nestjs/common';
import type { FeaturesDto } from '@wiki/shared';
import { APP_CONFIG, AppConfig } from '../config';

/** Welche optionalen Dienste eingeschaltet sind (install.sh bzw. wikictl schalten sie in .env) */
@Controller('features')
export class FeaturesController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  features(): FeaturesDto {
    return { office: this.config.OFFICE_ENABLED, drawio: this.config.DRAWIO_ENABLED };
  }
}
