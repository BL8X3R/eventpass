// Cliente HTTP de EventPass. Toda lectura y escritura pasa por los webhooks de n8n:
// el navegador nunca habla con Google Sheets.

const CFG = window.EVENTPASS_CONFIG || {};
export const config = {
  n8nBase: String(CFG.N8N_BASE_URL || '').replace(/\/+$/, ''),
  chatUrl: String(CFG.N8N_CHAT_URL || ''),
  botTelegram: String(CFG.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
};

export class ErrorApi extends Error {
  constructor(codigo, mensaje, status = 0) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

const CABECERAS = {
  'Content-Type': 'application/json',
  // Evita la página intermedia de ngrok en el plan gratuito.
  'ngrok-skip-browser-warning': '1',
};

async function post(url, cuerpo) {
  if (!config.n8nBase && !url.startsWith('http')) {
    throw new ErrorApi('SIN_CONFIG', 'Falta configurar N8N_BASE_URL. Revisa el archivo .env o las variables de Vercel.');
  }
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: CABECERAS, body: JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorApi('SIN_CONEXION', 'No se pudo conectar con el servidor de EventPass. Revisa tu conexión e intenta de nuevo.');
  }
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta no JSON */ }
  if (!datos) throw new ErrorApi('RESPUESTA_INVALIDA', `El servidor respondió sin datos (HTTP ${res.status}). Si n8n está apagado, enciéndelo y vuelve a intentar.`, res.status);
  if (!res.ok || datos.ok === false) {
    throw new ErrorApi(datos.error?.codigo || 'ERROR', datos.error?.mensaje || `Error HTTP ${res.status}.`, res.status);
  }
  return datos;
}

const webhook = (recurso, cuerpo) => post(`${config.n8nBase}/webhook/eventpass/${recurso}`, cuerpo);

// ---------- Sesión y visitante (solo comodidad local; la verdad está en n8n) ----------
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const escribir = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento bloqueado */ } };

let sesionEnMemoria = leer('ep_sesion');
export const sesion = {
  actual: () => sesionEnMemoria,
  token: () => sesionEnMemoria?.session_token || null,
  guardar(s) { sesionEnMemoria = s; escribir('ep_sesion', s); },
  borrar() { sesionEnMemoria = null; escribir('ep_sesion', null); },
};

export function visitorId() {
  let id = leer('ep_visitor');
  if (!id) { id = 'vis-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); escribir('ep_visitor', id); }
  return id;
}

// ---------- Endpoints ----------
export const api = {
  catalogo: {
    listado: () => webhook('catalogo', { accion: 'listado', visitor_id: visitorId() }),
    filtro: (categoria) => webhook('catalogo', { accion: 'filtro', categoria, visitor_id: visitorId() }),
    detalle: (evento_id) => webhook('catalogo', { accion: 'detalle', evento_id, visitor_id: visitorId() }),
  },
  usuarios: {
    crear: (datos) => webhook('usuarios', { accion: 'crear', ...datos }),
    perfil: () => webhook('usuarios', { accion: 'perfil', session_token: sesion.token() }),
    actualizar: (datos) => webhook('usuarios', { accion: 'actualizar', session_token: sesion.token(), ...datos }),
    desactivar: (password) => webhook('usuarios', { accion: 'desactivar', session_token: sesion.token(), password }),
  },
  auth: {
    login: (email, password) => webhook('auth', { accion: 'login', email, password }),
    logout: () => webhook('auth', { accion: 'logout', session_token: sesion.token() }),
    validar: () => webhook('auth', { accion: 'validar', session_token: sesion.token() }),
  },
  telegram: {
    solicitarCodigo: () => webhook('telegram', { accion: 'solicitar_codigo', session_token: sesion.token() }),
    estado: () => webhook('telegram', { accion: 'estado', session_token: sesion.token() }),
  },
  inscripciones: {
    crear: (evento_id, extra = {}) => webhook('inscripciones', { accion: 'crear', session_token: sesion.token(), evento_id, ...extra }),
    mias: () => webhook('inscripciones', { accion: 'mis_inscripciones', session_token: sesion.token() }),
    actualizar: (inscripcion_id, datos) => webhook('inscripciones', { accion: 'actualizar', session_token: sesion.token(), inscripcion_id, ...datos }),
    cancelar: (inscripcion_id) => webhook('inscripciones', { accion: 'cancelar', session_token: sesion.token(), inscripcion_id }),
  },
  async chat(sessionId, texto) {
    if (!config.chatUrl) throw new ErrorApi('SIN_CONFIG', 'El asistente no está configurado (falta N8N_CHAT_URL).');
    const u = sesion.actual()?.usuario;
    let res;
    try {
      res = await fetch(config.chatUrl, {
        method: 'POST',
        headers: CABECERAS,
        body: JSON.stringify({ action: 'sendMessage', sessionId, chatInput: texto, metadata: { usuario_id: u?.usuario_id || '', visitor_id: visitorId() } }),
      });
    } catch {
      throw new ErrorApi('SIN_CONEXION', 'No se pudo conectar con el asistente. Intenta de nuevo.');
    }
    const datos = await res.json().catch(() => null);
    if (!res.ok || !datos) throw new ErrorApi('ERROR', 'El asistente no pudo responder ahora. Intenta en un momento.', res.status);
    return String(datos.output ?? datos.text ?? '');
  },
};
