'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL, type CapturedRequest } from '../../../lib/api';
import { ReplayPanel } from './replay-panel';

// Show JSON nicely if the body is JSON, otherwise show it as-is.
function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body || '(empty body)';
  }
}

export default function EndpointPage() {
  const { slug } = useParams<{ slug: string }>();
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'notfound' | 'offline'>('loading');
  const [copied, setCopied] = useState(false);

  const captureUrl = `${API_URL}/h/${slug}`;

  // Runs once after the page appears (and again if slug changes).
  useEffect(() => {
    let source: EventSource | undefined;
    let cancelled = false;

    async function start() {
      try {
        // 1) load what was captured before we opened the page
        const res = await fetch(`${API_URL}/api/endpoints/${slug}/requests`);
        if (res.status === 404) return setStatus('notfound');
        if (!res.ok) throw new Error();
        const initial: CapturedRequest[] = await res.json();
        if (cancelled) return;
        setRequests(initial);

        // 2) open the live stream for everything that arrives from now on
        source = new EventSource(`${API_URL}/api/endpoints/${slug}/stream`);
        source.onopen = () => setStatus('live');
        source.onerror = () => setStatus('offline'); // the browser retries by itself
        source.onmessage = (event) => {
          const incoming: CapturedRequest = JSON.parse(event.data);
          // newest first; skip duplicates (the same request could be in both 1 and 2)
          setRequests((prev) =>
            prev.some((r) => r.id === incoming.id) ? prev : [incoming, ...prev],
          );
        };
      } catch {
        setStatus('offline');
      }
    }
    start();

    // Cleanup: when leaving the page, close the connection (avoids leaks).
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [slug]);

  const selected = requests.find((r) => r.id === selectedId) ?? requests[0];

  function copy() {
    navigator.clipboard.writeText(captureUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === 'notfound') {
    return <p className="error">This endpoint does not exist. <a href="/">Create a new one</a>.</p>;
  }

  return (
    <div className="page">
      <section className="urlbar">
        <div>
          <span className={`dot ${status}`} /> {status === 'live' ? 'Listening' : status}
        </div>
        <code>{captureUrl}</code>
        <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy URL'}</button>
        <pre className="hint">curl -X POST {captureUrl} -H "Content-Type: application/json" -d '{`{"hello":"world"}`}'</pre>
      </section>

      <div className="split">
        <ul className="list">
          {requests.length === 0 && <li className="empty">Waiting for the first request…</li>}
          {requests.map((r) => (
            <li
              key={r.id}
              className={r.id === selected?.id ? 'active' : ''}
              onClick={() => setSelectedId(r.id)}
            >
              <span className={`method ${r.method}`}>{r.method}</span>
              <span className="path">{r.path}</span>
              <time>{new Date(r.receivedAt).toLocaleTimeString()}</time>
            </li>
          ))}
        </ul>

        <article className="detail">
          {selected ? (
            <>
              <h2>
                <span className={`method ${selected.method}`}>{selected.method}</span> {selected.path}
              </h2>
              <p className="meta">
                {selected.ip} · {selected.bodySize} bytes · {new Date(selected.receivedAt).toLocaleString()}
              </p>
              <h3>Query</h3>
              <pre>{JSON.stringify(selected.query, null, 2)}</pre>
              <h3>Headers</h3>
              <pre>{JSON.stringify(selected.headers, null, 2)}</pre>
              <h3>Body</h3>
              <pre>{prettyBody(selected.body)}</pre>
              {/* key resets the form when you click a different request */}
              <ReplayPanel key={selected.id} slug={slug} request={selected} />
            </>
          ) : (
            <p className="empty">Send a request to the URL above and it will show up here.</p>
          )}
        </article>
      </div>
    </div>
  );
}
