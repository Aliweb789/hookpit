import type { NextFunction, Request, Response } from 'express';

export interface RateLimitOptions {
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Requests allowed per key inside one window. 0 or less turns the limiter off. */
  max: number;
  /** What counts as "one client". */
  key: (req: Request) => string;
}

/**
 * A small in-memory sliding-window limiter, so Hookpit needs no extra dependency.
 * Over the limit it answers 429 with a Retry-After header (seconds).
 * State lives in this process only: with several instances each one counts on its own.
 */
export function rateLimit({ windowMs, max, key }: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  return function limiter(req: Request, res: Response, next: NextFunction) {
    if (max <= 0) return next();

    const now = Date.now();
    const cutoff = now - windowMs;

    // Drop idle keys now and then so the map cannot grow without bound.
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [k, times] of hits) {
        if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(k);
      }
    }

    const id = key(req);
    const recent = (hits.get(id) ?? []).filter((t) => t > cutoff);
    if (recent.length >= max) {
      hits.set(id, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ ok: false, error: 'Too many requests', retryAfterSeconds: retryAfter });
      return;
    }
    recent.push(now);
    hits.set(id, recent);
    next();
  };
}

/** Reads a non-negative integer from the environment, falling back to `fallback`. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
