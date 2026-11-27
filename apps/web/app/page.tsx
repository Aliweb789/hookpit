'use client'; // runs in the browser: we need a button and state

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '../lib/api';
import { GithubIcon, InboxIcon, LayersIcon, RepeatIcon } from './icons';

const REPO = 'https://github.com/Aliweb789/hookpit';

const EXAMPLE_COMMAND = `curl -X POST http://localhost:4000/h/3fa5449afac2/stripe/events \\
  -H "Content-Type: application/json" \\
  -d '{"type":"payment_intent.succeeded","amount":4200}'`;

const FEATURES = [
  {
    icon: <InboxIcon size={20} />,
    title: 'Catch',
    text: 'Every request is stored exactly as sent: method, headers, query and the raw body. New ones appear live, with no refresh.',
  },
  {
    icon: <RepeatIcon size={20} />,
    title: 'Replay',
    text: 'Resend any captured request to your own app, edit it first, and see the response. Private networks are blocked by default.',
  },
  {
    icon: <LayersIcon size={20} />,
    title: 'Mock',
    text: 'Turn a capture URL into a fake API with status, headers, body templates and delays. Rehearse errors on demand.',
  },
];

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function createEndpoint() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/endpoints`, { method: 'POST' });
      if (!res.ok) throw new Error(`API answered ${res.status}`);
      const { slug } = await res.json();
      router.push(`/e/${slug}`); // go to the live page
    } catch (e) {
      setError(`Could not reach the Hookpit API at ${API_URL}. Is it running?`);
      setLoading(false);
    }
  }

  return (
    <div className="home">
      <section className="hero">
        <span className="eyebrow">
          <span className="dot" /> Open source · MIT · self-hosted
        </span>
        <h1>
          Catch, inspect, replay and <span className="grad">mock</span> webhooks.
        </h1>
        <p className="lead">
          Get a URL in one click. Send any HTTP request to it, watch it appear live, resend it to your app, or make it
          answer like a fake API. Your payloads stay on your own server.
        </p>
        <div className="cta">
          <button className="primary big" onClick={createEndpoint} disabled={loading}>
            {loading ? 'Creating…' : 'Create endpoint'}
          </button>
          <a className="btn big" href={REPO} target="_blank" rel="noopener noreferrer">
            <GithubIcon /> View on GitHub
          </a>
        </div>
        <p className="fine">No account, no sign-up. One click gives you a capture URL.</p>
        {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

        <div className="card terminal" aria-label="Example request">
          <div className="terminal-bar">
            <i /> <i /> <i />
            <span>Example: send a webhook to your capture URL</span>
          </div>
          <pre>
            <code>
              <span className="prompt">$ </span>
              {EXAMPLE_COMMAND}
              {'\n'}
              <span className="out">{'{"ok":true,"id":"8b0a617e-…"}'}</span>
            </code>
          </pre>
        </div>
      </section>

      <section className="features" aria-label="What Hookpit does">
        {FEATURES.map((f) => (
          <div className="card feature" key={f.title}>
            <div className="icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section className="card selfhost">
        <div>
          <h3>Self-host in one command</h3>
          <p className="meta">Two containers, SQLite storage, no external database.</p>
        </div>
        <pre>
          <code>docker compose up --build</code>
        </pre>
      </section>
    </div>
  );
}
