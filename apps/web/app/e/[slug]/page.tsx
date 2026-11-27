'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL, type CapturedRequest } from '../../../lib/api';
import { formatBytes, timeAgo } from '../../../lib/time';
import { CheckIcon, CopyIcon, InboxIcon } from '../../icons';
import { MocksPanel } from './mocks-panel';
import { ReplayPanel } from './replay-panel';

type Status = 'loading' | 'live' | 'notfound' | 'offline';

const STATUS_LABEL: Record<Exclude<Status, 'notfound'>, string> = {
  loading: 'Connecting…',
  live: 'Listening',
  offline: 'Reconnecting…',
};

// Pretty-print the body if it is JSON. Returns null when it is not.
function tryPrettyJson(body: string): string | null {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return null;
  }
}

// Colour the tokens of pretty-printed JSON. split() with a capturing group puts
// the matched tokens at the odd indexes, the text between them at the even ones.
const JSON_TOKEN = /("(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function JsonView({ text }: { text: string }) {
  if (text.length > 100_000) return <>{text}</>; // keep huge bodies fast
  return (
    <>
      {text.split(JSON_TOKEN).map((part, i) => {
        if (i % 2 === 0) return part;
        let cls = 'tok-num';
        if (part.startsWith('"')) cls = /:\s*$/.test(part) ? 'tok-key' : 'tok-str';
        else if (part === 'true' || part === 'false' || part === 'null') cls = 'tok-lit';
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        );
      })}
    </>
  );
}

function KeyValue({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {Array.isArray(value)
              ? value.map(String).join(', ')
              : typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : String(value ?? '')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function EndpointPage() {
  const { slug } = useParams<{ slug: string }>();
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [copied, setCopied] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set()); // ids that just arrived (for a highlight)
  const [now, setNow] = useState(() => Date.now()); // re-render so "12s ago" stays current

  const captureUrl = `${API_URL}/h/${slug}`;
  const curlExample = `curl -X POST ${captureUrl} -H "Content-Type: application/json" -d '{"hello":"world"}'`;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

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
          setRequests((prev) => (prev.some((r) => r.id === incoming.id) ? prev : [incoming, ...prev]));
          setFresh((prev) => new Set(prev).add(incoming.id));
          setTimeout(
            () =>
              setFresh((prev) => {
                const next = new Set(prev);
                next.delete(incoming.id);
                return next;
              }),
            1800,
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

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
  }

  if (status === 'notfound') {
    return (
      <div className="card notfound">
        <h2>Endpoint not found</h2>
        <p className="meta">This endpoint does not exist (or was created on another Hookpit server).</p>
        <Link className="btn primary" href="/">
          Create a new endpoint
        </Link>
      </div>
    );
  }

  const prettyBody = selected ? tryPrettyJson(selected.body) : null;

  return (
    <div className="page">
      <section className="card endpoint">
        <div className="endpoint-head">
          <h1>
            Endpoint <code className="slug">{slug}</code>
          </h1>
          <span className={`pill ${status}`} role="status">
            <span className="dot" /> {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="field-label">Capture URL</div>
        <div className="copyrow">
          <code className="url">{captureUrl}</code>
          <button onClick={() => copy(captureUrl, 'url')}>
            {copied === 'url' ? <CheckIcon /> : <CopyIcon />}
            {copied === 'url' ? 'Copied' : 'Copy URL'}
          </button>
        </div>

        <div className="curl">
          <pre>{curlExample}</pre>
          <button onClick={() => copy(curlExample, 'curl')} aria-label="Copy the curl command">
            {copied === 'curl' ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </section>

      {requests.length === 0 ? (
        <section className="card empty-state">
          <div className="icon">
            <InboxIcon size={26} />
          </div>
          <h2>Waiting for the first request</h2>
          <p>
            Send anything to the capture URL above (any method, any path). It shows up here the moment it arrives, with no
            refresh needed.
          </p>
        </section>
      ) : (
        <div className="split">
          <aside className="card list-wrap" aria-label="Captured requests">
            <div className="list-head">
              Requests <span className="count">{requests.length}</span>
            </div>
            <ul className="list">
              {requests.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`item${fresh.has(r.id) ? ' fresh' : ''}`}
                    aria-current={r.id === selected?.id}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="item-top">
                      <span className={`method ${r.method}`}>{r.method}</span>
                      <span className="path">{r.path}</span>
                    </span>
                    <span className="item-meta">
                      <time dateTime={r.receivedAt} title={new Date(r.receivedAt).toLocaleString()}>
                        {timeAgo(r.receivedAt, now)}
                      </time>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(r.bodySize)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {selected && (
            <article className="card detail">
              <div className="detail-head">
                <div className="detail-title">
                  <span className={`method ${selected.method}`}>{selected.method}</span>
                  <span className="path">{selected.path}</span>
                </div>
                <div className="chips">
                  <span className="chip" title={new Date(selected.receivedAt).toLocaleString()}>
                    {timeAgo(selected.receivedAt, now)}
                  </span>
                  <span className="chip">{formatBytes(selected.bodySize)}</span>
                  <span className="chip">from {selected.ip || 'unknown'}</span>
                </div>
              </div>

              <div className="detail-body">
                <section className="block">
                  <h3>Query</h3>
                  {Object.keys(selected.query).length > 0 ? (
                    <KeyValue data={selected.query} />
                  ) : (
                    <p className="none">No query parameters</p>
                  )}
                </section>

                <section className="block">
                  <h3>
                    Headers <span className="count">{Object.keys(selected.headers).length}</span>
                  </h3>
                  <KeyValue data={selected.headers} />
                </section>

                <section className="block">
                  <h3>
                    Body {selected.body && <span className="badge">{prettyBody ? 'JSON' : 'TEXT'}</span>}
                  </h3>
                  {selected.body ? (
                    <pre className="code">{prettyBody ? <JsonView text={prettyBody} /> : selected.body}</pre>
                  ) : (
                    <p className="none">No body</p>
                  )}
                </section>

                {/* key resets the form when you click a different request */}
                <ReplayPanel key={selected.id} slug={slug} request={selected} />
              </div>
            </article>
          )}
        </div>
      )}

      {/* Configuration lives below the live feed: you watch requests far more often than you edit mocks. */}
      <MocksPanel slug={slug} />
    </div>
  );
}
