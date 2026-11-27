import {
  All, Controller, Get, NotFoundException, Param, Post, Req, Res, Sse,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { MocksService } from '../mocks/mocks.service';
import { CaptureService } from './capture.service';

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

@Controller()
export class CaptureController {
  constructor(
    private readonly capture: CaptureService,
    private readonly mocks: MocksService,
  ) {}

  // --- Management API (used by the dashboard) ---

  @Post('api/endpoints')
  create() {
    return this.capture.createEndpoint();
  }

  @Get('api/endpoints/:slug/requests')
  list(@Param('slug') slug: string) {
    if (!this.capture.endpointExists(slug)) throw new NotFoundException();
    return this.capture.list(slug);
  }

  // @Sse turns the returned Observable into a Server-Sent Events stream.
  @Sse('api/endpoints/:slug/stream')
  stream(@Param('slug') slug: string): Observable<{ data: unknown }> {
    if (!this.capture.endpointExists(slug)) throw new NotFoundException();
    return this.capture.stream(slug).pipe(map((r) => ({ data: r })));
  }

  // --- Catch-all: the public URL that other services call ---

  @All(['h/:slug', 'h/:slug/*path'])
  async receive(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    if (!this.capture.endpointExists(slug)) {
      return res.status(404).json({ ok: false, error: 'Unknown endpoint' });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const path = req.originalUrl.split('?')[0].replace(`/h/${slug}`, '') || '/';

    const saved = this.capture.record({
      slug,
      method: req.method,
      path,
      query: req.query,
      headers: req.headers,
      body: raw.toString('utf8'),
      bodySize: raw.length,
      ip: req.ip ?? '',
    });

    // The request is already saved (so it shows up in the dashboard right away).
    // If a mock rule matches, answer with it; otherwise send the default acknowledgement.
    const match = this.mocks.findMatch(slug, req.method, path);
    if (!match) return res.status(200).json({ ok: true, id: saved.id });

    const mock = this.mocks.render(match, {
      method: req.method,
      path,
      query: req.query,
      headers: req.headers,
      body: saved.body,
    });
    if (mock.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, mock.delayMs));

    res.status(mock.status);
    for (const [name, value] of Object.entries(mock.headers)) res.setHeader(name, value);
    if (!res.hasHeader('content-type')) {
      res.setHeader('content-type', isJson(mock.body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
    }
    // Forced on every mock response. The body and content type are user-supplied
    // but served from our origin, so stop browsers from sniffing or running it as a page.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "sandbox; default-src 'none'");
    res.setHeader('x-hookpit-mock', match.rule.id);

    const noBody = req.method === 'HEAD' || mock.status === 204 || mock.status === 304;
    return res.end(noBody ? undefined : mock.body);
  }
}
