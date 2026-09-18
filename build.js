// Injects Vercel environment variables and shared rules into a deployable copy (dist/index.html).
// Run by Vercel at build time: Build Command `npm run build`, Output Directory `dist`.
// When an env var is not set, the built file keeps the default value from index.html.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const env = process.env || {};

// Load shared rules (single source of truth) - ES module import via file:// URL
const sharedPath = resolve(__dirname, 'shared/rules.js');
const sharedUrl = 'file:///' + sharedPath.replace(/\\/g, '/');
const shared = await import(sharedUrl);

function injectToken(html, token, value) {
  const re = new RegExp(`['"]${token}['"]`, 'g');
  return html.replace(re, value ? JSON.stringify(value) : '""');
}

function injectJsConst(html, placeholder, value) {
  // Replace __PLACEHOLDER__ with the actual JS value
  const re = new RegExp(`__${placeholder}__`, 'g');
  return html.replace(re, JSON.stringify(value, null, 2));
}

let html = readFileSync('index.html', 'utf8');

// Inject Vercel env vars
html = injectToken(html, '__SUPABASE_URL__', env.SUPABASE_URL);
html = injectToken(html, '__SUPABASE_ANON_KEY__', env.SUPABASE_ANON_KEY);

// Inject shared rules (named exports)
html = injectJsConst(html, 'FURNITURE_DEFS', shared.FURNITURE_DEFS);
html = injectJsConst(html, 'PASSIVE_IDS', shared.PASSIVE_IDS);
html = injectJsConst(html, 'CLEARANCE_RULES', shared.CLEARANCE_RULES);
html = injectJsConst(html, 'ANCHOR_ORDER', shared.ANCHOR_ORDER);
html = injectJsConst(html, 'SUGGESTED_LAYOUTS', shared.SUGGESTED_LAYOUTS);

mkdirSync('public', { recursive: true });
writeFileSync('public/index.html', html);

console.log('[build] public/index.html generated with shared rules injected');