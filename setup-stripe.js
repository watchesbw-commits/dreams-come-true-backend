/**
 * setup-stripe.js
 * Configura automáticamente Stripe para Dreams Come True:
 *   1. Crea el producto
 *   2. Crea el precio mensual
 *   3. Registra el webhook endpoint
 *   4. Imprime y guarda los IDs resultantes en stripe-config.txt
 *
 * Uso: node setup-stripe.js
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 1. OBTENER STRIPE_SECRET_KEY ────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

async function askForKey() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n🔑  Pega tu STRIPE_SECRET_KEY (empieza con sk_): ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

loadEnv();

let STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_KEY) {
  console.log('\n⚠️  No se encontró STRIPE_SECRET_KEY en el entorno ni en .env');
  STRIPE_KEY = await askForKey();
}

if (!STRIPE_KEY || !STRIPE_KEY.startsWith('sk_')) {
  console.error('\n❌  La clave no parece válida (debe empezar con sk_test_ o sk_live_). Abortando.');
  process.exit(1);
}

console.log('\n✅  Clave encontrada:', STRIPE_KEY.slice(0, 12) + '...');

// ─── 2. HELPER: llamada autenticada a la API de Stripe ───────────────────────

const STRIPE_BASE = 'https://api.stripe.com/v1';
const authHeader = 'Basic ' + Buffer.from(STRIPE_KEY + ':').toString('base64');

async function stripePost(endpoint, params) {
  // Stripe espera application/x-www-form-urlencoded
  const body = new URLSearchParams();

  function flatten(obj, prefix = '') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        flatten(v, key);
      } else if (Array.isArray(v)) {
        v.forEach(item => body.append(`${key}[]`, item));
      } else {
        body.append(key, String(v));
      }
    }
  }
  flatten(params);

  const res = await fetch(`${STRIPE_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe error en ${endpoint}: ${json.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

// ─── 3. CREAR PRODUCTO ───────────────────────────────────────────────────────

console.log('\n📦  Creando producto en Stripe...');

const product = await stripePost('/products', {
  name: 'Dreams Come True — 3 Sueños',
  description: 'Suscripción mensual: genera 3 videos de sueños con IA cada mes',
});

console.log(`   ✅  Producto creado: ${product.id} — "${product.name}"`);

// ─── 4. CREAR PRECIO ─────────────────────────────────────────────────────────

console.log('\n💲  Creando precio mensual ($12.99 USD)...');

const price = await stripePost('/prices', {
  product: product.id,
  unit_amount: 1299,
  currency: 'usd',
  recurring: { interval: 'month' },
});

console.log(`   ✅  Precio creado: ${price.id}`);

// ─── 5. CREAR WEBHOOK ────────────────────────────────────────────────────────

console.log('\n🔔  Registrando webhook endpoint...');

const webhook = await stripePost('/webhook_endpoints', {
  url: 'https://dreams-come-true-backend.onrender.com/webhook',
  enabled_events: [
    'invoice.payment_succeeded',
    'customer.subscription.deleted',
    'customer.subscription.updated',
  ],
});

console.log(`   ✅  Webhook creado: ${webhook.id}`);
console.log(`   URL: ${webhook.url}`);

// ─── 6. RESULTADO FINAL ──────────────────────────────────────────────────────

const priceId   = price.id;
const webhookSecret = webhook.secret;  // solo visible al crearlo

const output = `
╔══════════════════════════════════════════════════════╗
║       STRIPE SETUP — Dreams Come True                ║
╚══════════════════════════════════════════════════════╝

✅  STRIPE_PRICE_ID      = ${priceId}
✅  STRIPE_WEBHOOK_SECRET = ${webhookSecret}

Agrega estas variables en:
  • Render  → Environment Variables de tu backend
  • .env local (para desarrollo)

Producto ID  : ${product.id}
Webhook ID   : ${webhook.id}
Creado el    : ${new Date().toISOString()}
`;

console.log(output);

// ─── 7. GUARDAR EN ARCHIVO ───────────────────────────────────────────────────

const configPath = path.join(__dirname, 'stripe-config.txt');
fs.writeFileSync(configPath, output, 'utf8');
console.log(`💾  Configuración guardada en: stripe-config.txt\n`);
