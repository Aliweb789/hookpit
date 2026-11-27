'use client'; // runs in the browser: we need a button and state

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '../lib/api';

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
    <section className="hero">
      <h1>Catch, inspect and replay webhooks.</h1>
      <p>Get a URL in one click. Send any HTTP request to it and watch it appear live.</p>
      <button className="primary" onClick={createEndpoint} disabled={loading}>
        {loading ? 'Creating…' : 'Create endpoint'}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
