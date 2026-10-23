// Helpers para construir workflows de n8n como objetos JSON.
// Los IDs de Google Sheets, credenciales y sub-workflows llegan desde config.local.json.
import { randomUUID, createHash } from 'node:crypto';

// UUID estable a partir de un texto: las URLs de webhooks (chat, Telegram) no cambian entre despliegues.
function uuidEstable(texto) {
  const h = createHash('sha256').update(texto).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function crearWorkflow(nombre, cfg) {
  const nodes = [];
  const connections = {};

  const api = {
    nodes,
    connections,

    nodo(name, type, typeVersion, parameters, [x, y], extra = {}) {
      const n = { id: randomUUID(), name, type, typeVersion, position: [x * 240, y * 160], parameters, ...extra };
      nodes.push(n);
      return name;
    },

    // Conecta la salida `salida` de `origen` con `destino`.
    unir(origen, destino, salida = 0, tipo = 'main') {
      connections[origen] ??= {};
      connections[origen][tipo] ??= [];
      while (connections[origen][tipo].length <= salida) connections[origen][tipo].push([]);
      connections[origen][tipo][salida].push({ node: destino, type: tipo, index: 0 });
    },

    cadena(...nombres) {
      for (let i = 0; i < nombres.length - 1; i++) api.unir(nombres[i], nombres[i + 1]);
    },

    webhook(name, path, pos) {
      return api.nodo(name, 'n8n-nodes-base.webhook', 2, {
        httpMethod: 'POST',
        path,
        responseMode: 'responseNode',
        options: { allowedOrigins: '*' },
      }, pos, { webhookId: randomUUID() });
    },

    code(name, js, pos, extra = {}) {
      return api.nodo(name, 'n8n-nodes-base.code', 2, { jsCode: PRELUDIO + js }, pos, extra);
    },

    leer(name, ep, hoja, pos, extra = {}) {
      return api.nodo(name, 'n8n-nodes-base.googleSheets', 4.5, {
        operation: 'read',
        documentId: docRef(cfg, ep),
        sheetName: { __rl: true, mode: 'name', value: hoja },
        options: {},
      }, pos, { alwaysOutputData: true, executeOnce: true, credentials: credSheets(cfg), ...REINTENTO, ...extra });
    },

    agregarFila(name, ep, hoja, pos, extra = {}) {
      return api.nodo(name, 'n8n-nodes-base.googleSheets', 4.5, {
        operation: 'append',
        documentId: docRef(cfg, ep),
        sheetName: { __rl: true, mode: 'name', value: hoja },
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
        options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
      }, pos, { credentials: credSheets(cfg), ...REINTENTO, ...extra });
    },

    actualizarFila(name, ep, hoja, columnaClave, pos, extra = {}) {
      return api.nodo(name, 'n8n-nodes-base.googleSheets', 4.5, {
        operation: 'update',
        documentId: docRef(cfg, ep),
        sheetName: { __rl: true, mode: 'name', value: hoja },
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [columnaClave], schema: [] },
        options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
      }, pos, { credentials: credSheets(cfg), ...REINTENTO, ...extra });
    },

    agregarOActualizarFila(name, ep, hoja, columnaClave, pos, extra = {}) {
      return api.nodo(name, 'n8n-nodes-base.googleSheets', 4.5, {
        operation: 'appendOrUpdate',
        documentId: docRef(cfg, ep),
        sheetName: { __rl: true, mode: 'name', value: hoja },
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [columnaClave], schema: [] },
        options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
      }, pos, { credentials: credSheets(cfg), ...REINTENTO, ...extra });
    },

    // Switch por el campo `ruta` del item.
    switchRuta(name, rutas, pos, campo = 'ruta') {
      return api.nodo(name, 'n8n-nodes-base.switch', 3.2, {
        rules: {
          values: rutas.map((r) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [{ id: randomUUID(), leftValue: `={{ $json.${campo} }}`, rightValue: r, operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: r,
          })),
        },
        options: {},
      }, pos);
    },

    // IF sobre un campo booleano del item. Salida 0 = verdadero, 1 = falso.
    siVerdadero(name, campo, pos) {
      return api.nodo(name, 'n8n-nodes-base.if', 2.2, {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{ id: randomUUID(), leftValue: `={{ $json.${campo} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
          combinator: 'and',
        },
        options: {},
      }, pos);
    },

    filtro(name, campo, valores, pos) {
      return api.nodo(name, 'n8n-nodes-base.filter', 2.2, {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: valores.map((v) => ({ id: randomUUID(), leftValue: `={{ $json.${campo} }}`, rightValue: v, operator: { type: 'string', operation: 'equals' } })),
          combinator: 'or',
        },
        options: {},
      }, pos, { alwaysOutputData: true });
    },

    agrupar(name, destino, pos) {
      return api.nodo(name, 'n8n-nodes-base.aggregate', 1, {
        aggregate: 'aggregateAllItemData',
        destinationFieldName: destino,
        options: {},
      }, pos);
    },

    responder(name, pos) {
      return api.nodo(name, 'n8n-nodes-base.respondToWebhook', 1.1, {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify($json._body) }}',
        options: { responseCode: '={{ $json._status }}' },
      }, pos);
    },

    // Llama al servicio central de notificaciones (WF09), un item por llamada.
    notificar(name, pos) {
      return api.nodo(name, 'n8n-nodes-base.executeWorkflow', 1.2, {
        workflowId: { __rl: true, mode: 'id', value: cfg.workflows?.WF09 || 'WF09_PENDIENTE' },
        workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
        mode: 'each',
        options: { waitForSubWorkflow: true },
      }, pos, { alwaysOutputData: true });
    },

    // Elige la respuesta del nodo de decisión más específico que se ejecutó.
    armarRespuesta(name, candidatos, pos) {
      return api.code(name, `
const candidatos = ${JSON.stringify(candidatos)};
let fuente = null;
for (const n of candidatos) {
  if ($(n).isExecuted && $(n).first().json._body) { fuente = $(n).first().json; break; }
}
if (!fuente) fuente = { _status: 500, _body: { ok: false, error: { codigo: 'SIN_RESPUESTA', mensaje: 'La solicitud no produjo respuesta. Revisa la ejecución en n8n.' } } };
return [{ json: { _status: fuente._status || 200, _body: fuente._body, _auditoria: fuente._auditoria || null, _notificacion: fuente._notificacion || null } }];
`, pos);
    },

    json() {
      for (const n of nodes) if (n.webhookId) n.webhookId = uuidEstable(nombre + '/' + n.name);
      return {
        name: nombre,
        nodes,
        connections,
        settings: { executionOrder: 'v1', timezone: 'America/Bogota', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
      };
    },
  };
  return api;
}

function docRef(cfg, ep) {
  const id = cfg.sheets?.[ep] || `${ep}_ID_PENDIENTE`;
  return { __rl: true, mode: 'id', value: id };
}

// Google Sheets limita a 60 lecturas/escrituras por minuto: reintentar absorbe los picos.
const REINTENTO = { retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 };

function credSheets(cfg) {
  return { googleSheetsOAuth2Api: cfg.credenciales?.sheets || { id: 'PENDIENTE', name: 'Google Sheets EventPass' } };
}

// Utilidades disponibles en todos los Code nodes.
export const PRELUDIO = `// ---- utilidades EventPass ----
const ahora = new Date();
const genId = (p) => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const filas = (nodo, clave) => { try { return $(nodo).all().map((i) => i.json).filter((r) => r && r[clave] !== undefined && r[clave] !== null && String(r[clave]) !== ''); } catch (e) { return []; } };
const ok = (status, data, mensaje, extra = {}) => [{ json: { ...extra, _status: status, _body: { ok: true, mensaje, data } } }];
const fallo = (status, codigo, mensaje, extra = {}) => [{ json: { ruta: 'error', ...extra, _status: status, _body: { ok: false, error: { codigo, mensaje } } } }];
const sinFila = (r) => { const { row_number, ...resto } = r; return resto; };
const fechaEvento = (ev) => new Date(String(ev.fecha).slice(0, 10) + 'T' + (String(ev.hora || '00:00').slice(0, 5)) + ':00-05:00');
const validarSesion = (token, sesiones, usuarios) => {
  if (!token) return { ok: false, codigo: 'SESION_REQUERIDA', mensaje: 'Inicia sesión para continuar.' };
  const s = sesiones.find((x) => x.session_token === String(token));
  if (!s) return { ok: false, codigo: 'SESION_INVALIDA', mensaje: 'Tu sesión no es válida. Inicia sesión de nuevo.' };
  if (s.estado !== 'ACTIVA') return { ok: false, codigo: 'SESION_' + s.estado, mensaje: 'Tu sesión terminó. Inicia sesión de nuevo.', sesion: s };
  if (new Date(s.expira_en) <= ahora) return { ok: false, codigo: 'SESION_EXPIRADA', mensaje: 'Tu sesión expiró. Inicia sesión de nuevo.', sesion: s, expirada: true };
  const u = usuarios.find((x) => x.usuario_id === s.usuario_id);
  if (!u || u.estado !== 'ACTIVO') return { ok: false, codigo: 'USUARIO_INACTIVO', mensaje: 'Esta cuenta está desactivada.', sesion: s, inactivo: true };
  return { ok: true, sesion: s, usuario: u };
};
// ---- lógica del nodo ----
`;
