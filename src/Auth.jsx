// src/Auth.jsx
import React, { useState } from 'react';

export function SignIn({ apiBase, onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'login failed');
      localStorage.setItem('token', json.token);
      if (onSignedIn) onSignedIn(json.user);
    } catch (err) {
      alert('Sign in failed: ' + (err.message || err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 border rounded" required />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded" required />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded">{busy ? 'Signing in...' : 'Sign in'}</button>
        <a href={`${apiBase}/auth/google`} className="px-4 py-2 border rounded inline-block">Sign in with Google</a>
      </div>
    </form>
  );
}

export function SignUp({ apiBase, onSignedUp }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'signup failed');
      localStorage.setItem('token', json.token);
      if (onSignedUp) onSignedUp(json.user);
    } catch (err) {
      alert('Sign up failed: ' + (err.message || err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input placeholder="Full name" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border rounded" />
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 border rounded" required />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded" required />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-green-600 text-white rounded">{busy ? 'Signing up...' : 'Sign up'}</button>
      </div>
    </form>
  );
}
