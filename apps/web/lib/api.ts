// Where the Hookpit API lives. Override with NEXT_PUBLIC_API_URL.
// NEXT_PUBLIC_ means the value is baked into the browser bundle.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Same shape the API sends (see apps/api/src/capture/capture.service.ts).
export interface CapturedRequest {
  id: string;
  slug: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodySize: number;
  ip: string;
  receivedAt: string;
}
