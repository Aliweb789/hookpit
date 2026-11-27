'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../../lib/api';

interface MockRule {
  id: string;
  method: string; // an HTTP method, or '*' for any
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'text' | 'base64';
  delayMs: number;
  enabled: boolean;
}

const METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface Form {
  method: string;
  path: string;
  status: string;
  delayMs: string;
  headers: string; // one "Name: value" per line
  body: string;
  bodyEncoding: string; // 'text' or 'base64'
}

const EMPTY: Form = { method: '*', path: '/', status: '200', delayMs: '0', headers: 'Content-Type: application/json', body: '{"ok":true}', bodyEncoding: 'text' };

const headersToText = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');

function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

// Fake API responses for this endpoint. When a request matches a rule, Hookpit
// answers with it (the request is still captured above).
export function MocksPanel({ slug }: { slug: string }) {
  const base = `${API_URL}/api/endpoints/${slug}/mocks`;
  const [rules, setRules] = useState<MockRule[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) setRules(await res.json());
    } catch {
      /* the main page already shows when the API is unreachable */
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(url: string, method: string, payload?: object) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message ?? `Request failed (${res.status})`);
    }
  }

  async function save() {
    setError('');
    const payload = {
      method: form.method,
      path: form.path,
      status: Number(form.status),
      delayMs: Number(form.delayMs),
      headers: textToHeaders(form.headers),
      body: form.body,
      bodyEncoding: form.bodyEncoding,
      enabled: rules.find((r) => r.id === editing)?.enabled ?? true,
    };
    try {
      if (editing === 'new') await send(base, 'POST', payload);
      else await send(`${base}/${editing}`, 'PUT', payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule');
    }
  }

  async function toggle(rule: MockRule) {
    setError('');
    try {
      await send(`${base}/${rule.id}`, 'PUT', { ...rule, enabled: !rule.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the rule');
    }
  }

  async function remove(rule: MockRule) {
    setError('');
    try {
      await send(`${base}/${rule.id}`, 'DELETE');
      if (editing === rule.id) setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the rule');
    }
  }

  function startEdit(rule: MockRule) {
    setError('');
    setForm({
      method: rule.method,
      path: rule.path,
      status: String(rule.status),
      delayMs: String(rule.delayMs),
      headers: headersToText(rule.headers),
      body: rule.body,
      bodyEncoding: rule.bodyEncoding ?? 'text',
    });
    setEditing(rule.id);
  }

  function startNew() {
    setError('');
    setForm(EMPTY);
    setEditing('new');
  }

  const set = (field: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });

  return (
    <details className="mocks" open={rules.length > 0 || editing !== null}>
      <summary>
        Mock responses <span className="count">{rules.length}</span>
      </summary>
      <p className="meta">
        Answer requests with a fake API response. Rules are tried top to bottom; the first match wins, otherwise Hookpit replies{' '}
        <code>{'{"ok":true}'}</code>.
      </p>

      {rules.length > 0 && (
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? '' : 'off'}>
              <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} aria-label={`Enable rule for ${r.path}`} />
              <span className={`method ${r.method}`}>{r.method === '*' ? 'ANY' : r.method}</span>
              <span className="path">{r.path}</span>
              <span className="meta">
                → {r.status}
                {r.delayMs > 0 ? ` · ${r.delayMs} ms` : ''}
                {r.bodyEncoding === 'base64' ? ' · binary' : ''}
              </span>
              <button onClick={() => startEdit(r)}>Edit</button>
              <button onClick={() => remove(r)} aria-label={`Delete rule for ${r.path}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      {editing === null ? (
        <button onClick={startNew}>+ Add rule</button>
      ) : (
        <div className="rule-form">
          <div className="replay-row">
            <select value={form.method} onChange={set('method')} aria-label="Method">
              {METHODS.map((m) => (
                <option key={m} value={m}>{m === '*' ? 'ANY' : m}</option>
              ))}
            </select>
            <input value={form.path} onChange={set('path')} placeholder="/users/:id  or  /files/*" aria-label="Path pattern" />
          </div>
          <div className="replay-row">
            <label>Status <input type="number" min={200} max={599} value={form.status} onChange={set('status')} aria-label="Status" /></label>
            <label>Delay (ms) <input type="number" min={0} max={10000} value={form.delayMs} onChange={set('delayMs')} aria-label="Delay in milliseconds" /></label>
            <label>Encoding{' '}
              <select value={form.bodyEncoding} onChange={set('bodyEncoding')} aria-label="Body encoding">
                <option value="text">Text</option>
                <option value="base64">Base64 (binary)</option>
              </select>
            </label>
          </div>
          <label className="block">Headers (one per line)
            <textarea rows={2} spellCheck={false} value={form.headers} onChange={set('headers')} aria-label="Response headers" />
          </label>
          <label className="block">{form.bodyEncoding === 'base64' ? 'Body (base64)' : 'Body'}
            <textarea rows={5} spellCheck={false} value={form.body} onChange={set('body')} aria-label="Response body" />
          </label>
          {form.bodyEncoding === 'base64' ? (
            <p className="meta">
              The body is decoded and sent as raw bytes (for example an image or a PDF), up to 256 KB. Placeholders are not filled in.
              Set a <code>Content-Type</code> header, otherwise <code>application/octet-stream</code> is used.
            </p>
          ) : (
            <p className="meta">
              Placeholders (body only): <code>{'{{uuid}}'}</code> <code>{'{{now}}'}</code> <code>{'{{params.id}}'}</code>{' '}
              <code>{'{{request.query.page}}'}</code> <code>{'{{request.json.name}}'}</code> <code>{'{{request.headers.x-id}}'}</code>
            </p>
          )}
          <div className="replay-row">
            <button className="primary small" onClick={save}>Save rule</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </details>
  );
}
