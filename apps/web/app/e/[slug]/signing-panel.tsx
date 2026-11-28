'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, type SignatureProvider } from '../../../lib/api';

type Config = { configured: false } | { configured: true; provider: SignatureProvider };

export const PROVIDER_LABEL: Record<SignatureProvider, string> = {
  github: 'GitHub',
  stripe: 'Stripe',
  slack: 'Slack',
};

const HINT: Record<SignatureProvider, string> = {
  github: 'The webhook secret from the GitHub webhook settings.',
  stripe: 'The signing secret that starts with whsec_ (Stripe dashboard, Webhooks).',
  slack: 'The Signing Secret from your Slack app (Basic Information).',
};

// Lets you give Hookpit the secret a service signs its webhooks with, so every
// captured request is marked valid, invalid or unsigned. The secret is
// write-only: the server never sends it back, so it cannot be shown here.
export function SigningPanel({ slug, onChange }: { slug: string; onChange: () => void }) {
  const base = `${API_URL}/api/endpoints/${slug}/signing`;
  const [config, setConfig] = useState<Config>({ configured: false });
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<SignatureProvider>('github');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) setConfig(await res.json());
    } catch {
      /* the main page already shows when the API is unreachable */
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setError('');
    try {
      const res = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, secret }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Request failed (${res.status})`);
      }
      setSecret(''); // do not keep it in the page once it has been sent
      setEditing(false);
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the secret');
    }
  }

  async function remove() {
    setError('');
    try {
      const res = await fetch(base, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setEditing(false);
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the secret');
    }
  }

  function startEdit() {
    setError('');
    setSecret('');
    if (config.configured) setProvider(config.provider);
    setEditing(true);
  }

  return (
    <details className="signing" open={config.configured || editing}>
      <summary>
        Signature check{' '}
        {config.configured && <span className="count">{PROVIDER_LABEL[config.provider]}</span>}
      </summary>
      <p className="meta">
        Add the secret a service signs its webhooks with (GitHub, Stripe or Slack) and every captured request is marked
        valid, invalid or unsigned. The secret is stored on your server and is never sent back to the browser.
      </p>

      {config.configured && !editing && (
        <div className="signing-state">
          <span>
            Checking requests as <strong>{PROVIDER_LABEL[config.provider]}</strong>
          </span>
          <button onClick={startEdit}>Change</button>
          <button onClick={remove}>Remove</button>
        </div>
      )}

      {!config.configured && !editing && <button onClick={startEdit}>+ Add secret</button>}

      {editing && (
        <div className="rule-form">
          <div className="replay-row">
            <select value={provider} onChange={(e) => setProvider(e.target.value as SignatureProvider)} aria-label="Provider">
              {(Object.keys(PROVIDER_LABEL) as SignatureProvider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </select>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Signing secret"
              aria-label="Signing secret"
            />
          </div>
          <p className="meta">{HINT[provider]}</p>
          <div className="replay-row">
            <button className="primary small" onClick={save} disabled={secret.trim() === ''}>Save secret</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
