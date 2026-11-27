'use client';

import { useState } from 'react';
import { API_URL, type CapturedRequest } from '../../../lib/api';

interface ReplayResult {
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const URL_KEY = 'hookpit:last-replay-url';

// Resend a captured request to any URL, optionally editing method and body first.
// The request is sent by the Hookpit API (not the browser), so it also works
// for targets the browser could not call because of CORS.
export function ReplayPanel({ slug, request }: { slug: string; request: CapturedRequest }) {
  const [url, setUrl] = useState(
    () => (typeof window !== 'undefined' && localStorage.getItem(URL_KEY)) || 'http://localhost:3000/webhook',
  );
  const [method, setMethod] = useState(request.method);
  const [body, setBody] = useState(request.body);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReplayResult | null>(null);

  async function send() {
    setSending(true);
    setError('');
    setResult(null);
    try {
      localStorage.setItem(URL_KEY, url);
      const res = await fetch(`${API_URL}/api/endpoints/${slug}/requests/${request.id}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Replay failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setSending(false);
    }
  }

  const noBody = method === 'GET' || method === 'HEAD';

  return (
    <section className="replay">
      <h3>Replay</h3>
      <div className="replay-row">
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.example/webhook"
          aria-label="Target URL"
        />
        <button className="primary small" onClick={send} disabled={sending || !url}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <textarea
        value={noBody ? '' : body}
        onChange={(e) => setBody(e.target.value)}
        disabled={noBody}
        rows={5}
        spellCheck={false}
        aria-label="Body"
        placeholder={noBody ? `${method} requests have no body` : 'Body'}
      />

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="replay-result">
          <p>
            <span className={`status s${Math.floor(result.status / 100)}`}>
              {result.status} {result.statusText}
            </span>{' '}
            <span className="meta">
              · {result.durationMs} ms{result.bodyTruncated ? ' · body truncated to 1 MB' : ''}
            </span>
          </p>
          <h3>Response headers</h3>
          <pre>{JSON.stringify(result.headers, null, 2)}</pre>
          <h3>Response body</h3>
          <pre>{result.body || '(empty body)'}</pre>
        </div>
      )}
    </section>
  );
}
