// src/Login.jsx
import React, { useEffect, useState } from 'react';

export default function Login({ apiBase = process.env.REACT_APP_API_URL || '' , onLogin }) {
  // apiBase should be something like "https://hr-tools-backend.onrender.com" or "" to use same origin
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    // read token or oauth_error from query params after redirect from backend
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const oauthError = params.get('oauth_error');

    if (oauthError && !token) {
      setMsg({ type: 'error', text: decodeURIComponent(oauthError) });
      // remove query params from URL for cleanliness
      params.delete('oauth_error');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      return;
    }

    if (token) {
      // store token and notify parent
      localStorage.setItem('token', token);
      setMsg({ type: 'success', text: 'Sign-in successful. Redirecting...' });

      // remove token param from URL for cleanliness
      params.delete('token');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);

      // call parent's callback (if provided) so app can fetch profile
      if (typeof onLogin === 'function') {
        onLogin(token);
      } else {
        // fallback: reload page so existing App useEffect picks up token
        window.location.reload();
      }
    }
  }, [onLogin]);

  function startGoogleOAuth() {
    // open backend oauth route in same window (recommended) to allow callback redirect
    const url = `${apiBase || ''}/auth/google`;
    window.location.href = url;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded shadow p-6 text-center">
        <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
        <p className="mb-6 text-sm text-gray-600">Sign in with Google to manage job openings and view responses.</p>

        {msg && (
          <div className={`mb-4 px-4 py-2 rounded ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {msg.text}
          </div>
        )}

        <button
          onClick={startGoogleOAuth}
          className="inline-flex items-center justify-center gap-3 w-full border rounded px-4 py-2 hover:shadow-sm"
          style={{ background: '#fff' }}
        >
          <img alt="google" src="https://www.gstatic.com/devrel-devsite/prod/vc0a8b6d0b7f6b5a0c3ea8cfb5b2b4b1a6a3b2a1a2f8d9c0a1b2c3d4e5f6a7/logo_google_g_color_64dp.png" width="18" height="18" />
          <span className="text-sm">Sign in with Google</span>
        </button>

        <div className="mt-4 text-xs text-gray-500">
          If your email is not allowed you will see an error. Contact the admin to add your email in the backend `server_data/data.json`.
        </div>
      </div>
    </div>
  );
}
