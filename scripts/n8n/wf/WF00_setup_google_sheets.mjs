import { crearWorkflow } from '../lib.mjs';
import { readFileSync } from 'node:fs';

// Workflow auxiliar de un solo uso: crea los 10 archivos de Google Sheets con sus hojas,
// encabezados y datos de prueba. Se ejecuta una vez y luego se desactiva.
export default function (cfg) {
  const w = crearWorkflow('WF00 — Setup de Google Sheets (auxiliar)', cfg);
  const semilla = JSON.parse(readFileSync(new URL('../semilla.json', import.meta.url), 'utf8'));

  w.nodo('Webhook Setup', 'n8n-nodes-base.webhook', 2, {
    httpMethod: 'POST', path: 'eventpass/setup-sheets', responseMode: 'responseNode', options: {},
  }, [0, 1], { webhookId: crypto.randomUUID() });

  w.code('Definir archivos y datos de prueba', `
const s = ${JSON.stringify(semilla)};
const correo = String($('Webhook Setup').first().json.body?.correo_base || '').trim().toLowerCase();
const [local, dominio] = correo.includes('@') ? correo.split('@') : ['demo', 'example.com'];
const dia = 86400000;
const fechaLocal = (offsetMs) => new Date(Date.now() + offsetMs - 5 * 3600000).toISOString();
const reemplazar = (v) => {
  if (typeof v !== 'string') return v;
  let r = v.replace(/\\{EMAIL:(\\w+)\\}/g, (_, alias) => local + '+' + alias + '@' + dominio);
  r = r.replace(/\\{FECHA:(-?[\\d.]+)\\}/g, (_, d) => fechaLocal(Number(d) * dia).slice(0, 10));
  r = r.replace(/\\{HORA_EN:(-?[\\d.]+)\\}/g, (_, h) => fechaLocal(Number(h) * 3600000).slice(11, 13) + ':00');
  r = r.replace(/\\{FECHA_EN:(-?[\\d.]+)\\}/g, (_, h) => fechaLocal(Number(h) * 3600000).slice(0, 10));
  r = r.replace(/\\{ISO:(-?[\\d.]+)\\}/g, (_, d) => new Date(Date.now() + Number(d) * dia).toISOString());
  return r;
};
const celda = (v, negrita) => ({ userEnteredValue: { stringValue: String(v ?? '') }, ...(negrita ? { userEnteredFormat: { textFormat: { bold: true } } } : {}) });
// "solo" (opcional) limita la creación a ciertas claves, p. ej. ["EP11"] para añadir un archivo nuevo.
const solo = $('Webhook Setup').first().json.body?.solo;
return s.archivos.filter((a) => !Array.isArray(solo) || solo.includes(a.clave)).map((a) => ({ json: { clave: a.clave, cuerpo: {
  properties: { title: a.titulo, locale: 'es_CO', timeZone: 'America/Bogota' },
  sheets: a.hojas.map((h) => ({
    properties: { title: h.nombre, gridProperties: { frozenRowCount: 1 } },
    data: [{ startRow: 0, startColumn: 0, rowData: [
      { values: h.columnas.map((c) => celda(c, true)) },
      ...(h.filas || []).map((f) => ({ values: h.columnas.map((c) => celda(reemplazar(f[c]))) })),
    ] }],
  })),
} } }));
`, [1, 1]);

  w.nodo('Crear spreadsheet (Sheets API)', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: 'https://sheets.googleapis.com/v4/spreadsheets',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: {},
  }, [2, 1], { credentials: { googleSheetsOAuth2Api: cfg.credenciales?.sheets || { id: 'PENDIENTE', name: 'Google Sheets EventPass' } } });

  w.code('Resumen de IDs', `
const claves = $('Definir archivos y datos de prueba').all().map((i) => i.json.clave);
const archivos = $input.all().map((i, idx) => ({ clave: claves[idx], titulo: i.json.properties?.title, spreadsheetId: i.json.spreadsheetId, url: i.json.spreadsheetUrl }));
return [{ json: { _status: 200, _body: { ok: true, archivos } } }];
`, [3, 1]);
  w.responder('Responder', [4, 1]);

  w.cadena('Webhook Setup', 'Definir archivos y datos de prueba', 'Crear spreadsheet (Sheets API)', 'Resumen de IDs', 'Responder');
  return w.json();
}
