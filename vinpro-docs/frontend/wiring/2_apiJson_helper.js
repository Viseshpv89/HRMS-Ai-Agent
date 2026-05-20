/**
 * Vinpro HRMS — apiJson helper
 * 
 * If your existing src/api/liveClient.js already has an apiJson function, 
 * you do NOT need this file — just import from there.
 * 
 * If you don't have one yet, copy this into: src/api/liveClient.js
 * (or merge with your existing file)
 */

const BASE_URL = 'https://hrms.vinproconnect.com/api';

/**
 * apiJson — universal fetch wrapper for Vinpro HRMS API
 * @param {string} path   - API path e.g. '/compliance/changes'
 * @param {object} opts   - options: method, body, token
 */
export async function apiJson(path, opts = {}) {
  const { method = 'GET', body, token } = opts;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `API error ${res.status}`);
  }

  return res.json();
}
