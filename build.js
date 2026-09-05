// Injects Vercel environment variables into a deployable copy (dist/index.html).
// Run by Vercel at build time: Build Command `npm run build`, Output Directory `dist`.
// When an env var is not set, the built file keeps the default value from index.html.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = process.env || {};

function injectToken(html, token, value) {
  const re = new RegExp(`['"]${token}['"]`, 'g');
  return html.replace(re, value ? JSON.stringify(value) : '""');
}

let html = readFileSync('index.html', 'utf8');

html = injectToken(html, '__SUPABASE_URL__', env.SUPABASE_URL);
html = injectToken(html, '__SUPABASE_ANON_KEY__', env.SUPABASE_ANON_KEY);
html = injectToken(html, '__DETECT_API_BASE__', env.DETECT_API_BASE);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);

console.log('[build] dist/index.html generated');