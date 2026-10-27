import type { IncomingMessage } from 'node:http';
import { All, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config';
import { Public } from '../common/decorators';
import { ApiError } from '../common/errors';
import { clientIp, WikiRequest } from '../common/request-context';
import { RateLimitService } from '../infra/rate-limit.service';
import { OAuthService } from '../oauth/oauth.service';
import { ApiTokensService, mcpDisabled } from '../tokens/api-tokens.service';
import { McpService } from './mcp.service';

const invalidToken = () => new ApiError(401, 'INVALID_TOKEN', 'Fehlendes, ungültiges, abgelaufenes oder widerrufenes API-Token.');

/**
 * MCP-Endpunkt (Streamable HTTP, zustandslos, JSON-Antworten) unter /api/v1/mcp.
 *
 * Anmeldung nur per „Authorization: Bearer <API-Token>“, nie per Cookie: Ein Browser kann diesen Endpunkt so nicht
 * im Namen eines angemeldeten Benutzers aufrufen (deshalb auch ohne CSRF-Token, siehe csrf.middleware.ts).
 * Umgekehrt gelten API-Tokens nur hier und nicht für die übrige API.
 */
@Public()
@Controller('mcp')
export class McpController {
  private readonly origin: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: ApiTokensService,
    private readonly mcp: McpService,
    private readonly limiter: RateLimitService,
    private readonly audit: AuditService,
    private readonly oauth: OAuthService,
  ) {
    this.origin = new URL(config.APP_ORIGIN).origin;
  }

  @Post()
  @HttpCode(200)
  async handle(@Req() req: WikiRequest, @Res() res: Response) {
    const ip = clientIp(req);
    // Schutz vor DNS-Rebinding und Aufrufen aus fremden Webseiten: Browser schicken Origin immer mit
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== this.origin) throw new ApiError(403, 'FORBIDDEN', 'Aufrufe aus dem Browser sind hier nicht erlaubt.');

    // Nach wiederholt falschen Tokens wird die IP steigend gesperrt (wie bei der Anmeldung, S3)
    const scope = `mcp:ip:${ip}`;
    await this.limiter.assertNotLocked(scope);
    const header = req.headers.authorization ?? '';
    const raw = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const auth = raw ? await this.tokens.authenticate(raw, ip) : null;
    if (!auth) {
      // resource_metadata führt OAuth-Clients wie claude.ai zur Anmeldung (RFC 9728)
      res.setHeader('WWW-Authenticate', `Bearer realm="wikifordummys", resource_metadata="${this.oauth.resourceMetadataUrl}"`);
      if (raw) {
        await this.limiter.registerFailure(scope, 10);
        await this.audit.log({ action: 'mcp.auth.failed', ip, details: { prefix: raw.slice(0, 8) } });
      }
      throw invalidToken();
    }
    await this.limiter.clearFailures(scope);
    if (!(await this.tokens.isEnabled())) throw mcpDisabled();
    await this.limiter.enforce([{ key: `mcp:t:${auth.token.id}`, limit: this.config.RATE_MCP_PER_MINUTE, windowSec: 60 }]);

    const server = this.mcp.createServer(auth, ip);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // Eine Browser-Sitzung (Cookie) zählt hier nicht; das SDK würde req.auth sonst als eigene Anmeldung lesen
    delete req.auth;
    await transport.handleRequest(req as IncomingMessage, res, req.body);
  }

  /** Zustandslos: keine Benachrichtigungen per GET (SSE) und keine Sitzungen zum Beenden */
  @All()
  notAllowed(@Res() res: Response) {
    res
      .status(405)
      .setHeader('Allow', 'POST')
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Nur POST wird unterstützt.' }, id: null });
  }
}
