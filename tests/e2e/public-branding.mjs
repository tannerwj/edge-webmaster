// BASE=https://your-access-protected-host node tests/e2e/public-branding.mjs
import assert from 'node:assert/strict';
const base = new URL(process.env.BASE);
for (const [path, heading] of [['/about', 'Edge Webmaster'], ['/about/privacy', 'Privacy policy'], ['/about/terms', 'Terms of service']]) {
  const response = await fetch(new URL(path, base), { redirect: 'manual' });
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.ok(html.includes(`<h1>${heading}</h1>`), path);
  assert.ok(html.includes('href="/about/privacy"'), path);
  console.log('Public', path);
}
for (const path of ['/', '/api/status', '/mcp']) {
  const options = path === '/mcp'
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }
    : {};
  const response = await fetch(new URL(path, base), { ...options, redirect: 'manual' });
  assert.ok([302, 401, 403].includes(response.status), path);
  if (response.status === 302) assert.ok(response.headers.get('location')?.includes('/cdn-cgi/access/login/'), path);
  console.log('Sign-in required', path);
}
