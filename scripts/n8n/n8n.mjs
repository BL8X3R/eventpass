#!/usr/bin/env node
// Uso: node scripts/n8n/n8n.mjs <build|setup-sheets|setup-sheet|push|export|status> [correo_base | EPxx]
// Lee la API key de n8n desde ~/.config/eventpass/n8n_api_key (nunca desde el repo).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const CONFIG = join(AQUI, 'config.local.json');
const ORDEN = ['WF09_notificaciones', 'WF01_usuarios_crud', 'WF02_auth_sesiones', 'WF03_vinculacion_telegram', 'WF04_eventos_crud', 'WF05_catalogo_publico',
  'WF06_inscripciones_crud', 'WF07_reasignacion_lista_espera', 'WF08_recordatorios', 'WF10_eventpass_assistant', 'WF11_checkin_digital'];

const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
cfg.n8nUrl ||= 'http://localhost:5678';
cfg.workflows ||= {};
const guardarCfg = () => writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

function apiKey() {
  const ruta = join(homedir(), '.config', 'eventpass', 'n8n_api_key');
  if (!existsSync(ruta)) throw new Error('Falta la API key de n8n en ' + ruta);
  return readFileSync(ruta, 'utf8').trim();
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(cfg.n8nUrl + '/api/v1' + ruta, {
    method: metodo,
    headers: { 'X-N8N-API-KEY': apiKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${metodo} ${ruta} -> ${res.status}: ${texto.slice(0, 600)}`);
  return texto ? JSON.parse(texto) : {};
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// n8n 2.x publica y despublica en segundo plano: reintenta mientras responda 409.
async function conReintento(fn, intentos = 20) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= intentos || !/-> 409/.test(e.message)) throw e;
      await esperar(1000);
    }
  }
}

async function esperarWebhook(ruta) {
  for (let i = 0; i < 30; i++) {
    // Un GET no ejecuta el workflow; si el webhook POST ya existe, n8n sugiere usar POST.
    const r = await fetch(cfg.n8nUrl + '/webhook/' + ruta).catch(() => null);
    const texto = r ? await r.text() : '';
    if (r && (r.status !== 404 || /Did you mean to make a POST/i.test(texto))) return;
    await esperar(1000);
  }
  throw new Error('El webhook ' + ruta + ' no quedó registrado a tiempo.');
}

async function generar(nombre) {
  const mod = await import(join(AQUI, 'wf', nombre + '.mjs'));
  return mod.default(cfg);
}

async function subir(nombre, activar = true) {
  const wf = await generar(nombre);
  const id = cfg.workflows[nombre.slice(0, 4)];
  let res;
  if (id) {
    if (activar) await api('POST', `/workflows/${id}/deactivate`).catch(() => {});
    res = await conReintento(() => api('PUT', `/workflows/${id}`, wf));
  } else {
    res = await api('POST', '/workflows', wf);
    cfg.workflows[nombre.slice(0, 4)] = res.id;
    guardarCfg();
  }
  if (activar) await conReintento(() => api('POST', `/workflows/${res.id}/activate`));
  console.log(`✔ ${nombre} -> ${res.id}${activar ? ' (activo)' : ''}`);
  return res.id;
}

async function crearSheets(cuerpo) {
  const id = await subir('WF00_setup_google_sheets');
  try {
    await esperarWebhook('eventpass/setup-sheets');
    const res = await fetch(cfg.n8nUrl + '/webhook/eventpass/setup-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const data = await res.json();
    if (!data.ok) throw new Error(JSON.stringify(data));
    cfg.sheets = { ...cfg.sheets, ...Object.fromEntries(data.archivos.map((a) => [a.clave, a.spreadsheetId])) };
    cfg.sheetsUrls = { ...cfg.sheetsUrls, ...Object.fromEntries(data.archivos.map((a) => [a.clave, a.url])) };
    guardarCfg();
    for (const a of data.archivos) console.log(`✔ ${a.titulo}: ${a.url}`);
  } finally {
    await api('POST', `/workflows/${id}/deactivate`).catch(() => {});
  }
}

const comandos = {
  async build() {
    const dir = join(AQUI, 'build');
    mkdirSync(dir, { recursive: true });
    for (const n of ['WF00_setup_google_sheets', ...ORDEN]) {
      writeFileSync(join(dir, n + '.json'), JSON.stringify(await generar(n), null, 2));
      console.log('generado', n);
    }
  },

  async 'setup-sheets'(correoBase) {
    if (!correoBase) throw new Error('Indica el correo base para los usuarios demo, p. ej. tucorreo@gmail.com');
    if (cfg.sheets?.EP01) throw new Error('Los Sheets ya existen en config.local.json; no se crean de nuevo.');
    await crearSheets({ correo_base: correoBase });
  },

  // Crea un solo archivo nuevo (p. ej. EP11) cuando los demás ya existen.
  async 'setup-sheet'(clave) {
    if (!/^EP\d{2}$/.test(clave || '')) throw new Error('Indica la clave del archivo, p. ej. EP11');
    if (cfg.sheets?.[clave]) throw new Error(clave + ' ya existe en config.local.json; no se crea de nuevo.');
    await crearSheets({ solo: [clave] });
  },

  async push(solo) {
    const lista = solo ? ORDEN.filter((n) => n.startsWith(solo)) : ORDEN;
    for (const n of lista) await subir(n);
  },

  async export() {
    const destino = join(RAIZ, 'n8n');
    mkdirSync(destino, { recursive: true });
    for (const n of ['WF00_setup_google_sheets', ...ORDEN]) {
      const id = cfg.workflows[n.slice(0, 4)];
      if (!id) { console.log('omitido (no subido):', n); continue; }
      const wf = await api('GET', `/workflows/${id}`);
      const limpio = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, pinData: {}, active: wf.active, id: wf.id, tags: wf.tags || [] };
      writeFileSync(join(destino, n + '.json'), JSON.stringify(limpio, null, 2) + '\n');
      console.log('exportado', n);
    }
  },

  async status() {
    const r = await api('GET', '/workflows?limit=100');
    for (const w of r.data) console.log(w.active ? '●' : '○', w.id, w.name);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!comandos[cmd]) { console.log('Comandos:', Object.keys(comandos).join(', ')); process.exit(1); }
comandos[cmd](...args).catch((e) => { console.error('✖', e.message); process.exit(1); });
