import {
  All, Controller, Get, NotFoundException, Param, Post, Req, Res, Sse,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { CaptureService } from './capture.service';

@Controller()
export class CaptureController {
  constructor(private readonly capture: CaptureService) {}

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
  receive(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
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
    return res.status(200).json({ ok: true, id: saved.id });
  }
}
