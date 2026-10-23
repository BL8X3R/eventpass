// Copia frontend/ a dist/ y genera dist/config.js con las variables públicas.
// En Vercel las variables vienen del panel (Settings → Environment Variables); en local, del archivo .env.
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VARIABLES = ['N8N_BASE_URL', 'N8N_CHAT_URL', 'TELEGRAM_BOT_USERNAME'];

const env = { ...process.env };
const archivoEnv = join(RAIZ, '.env');
if (existsSync(archivoEnv)) {
  for (const linea of readFileSync(archivoEnv, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const faltan = VARIABLES.filter((k) => !env[k]);
if (faltan.length) console.warn('⚠ Variables sin definir:', faltan.join(', '));

const dist = join(RAIZ, 'dist');
rmSync(dist, { recursive: true, force: true });
cpSync(join(RAIZ, 'frontend'), dist, { recursive: true });
const publico = Object.fromEntries(VARIABLES.map((k) => [k, env[k] || '']));
writeFileSync(join(dist, 'config.js'), `window.EVENTPASS_CONFIG = ${JSON.stringify(publico, null, 2)};\n`);
console.log('✔ dist/ generado con', Object.keys(publico).join(', '));
