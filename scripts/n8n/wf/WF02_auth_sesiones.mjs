import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF02 — Autenticación y sesiones', cfg);

  w.webhook('Webhook Auth', 'eventpass/auth', [0, 1]);
  w.leer('Leer Usuarios', 'EP01', 'Usuarios', [1, 1]);
  w.leer('Leer Sesiones', 'EP02', 'Sesiones', [2, 1]);

  w.code('Validar solicitud', `
const b = $('Webhook Auth').first().json.body || {};
const accion = String(b.accion || '').trim().toLowerCase();
if (accion === 'login') {
  if (!b.email || !b.password) return fallo(400, 'DATOS_INVALIDOS', 'Escribe tu email y tu contraseña.');
  return [{ json: { ruta: 'login', email: String(b.email).trim().toLowerCase(), password: String(b.password) } }];
}
if (accion === 'logout' || accion === 'validar') {
  if (!b.session_token) return fallo(400, 'SESION_REQUERIDA', 'Falta el token de sesión.');
  return [{ json: { ruta: 'sesion', accion, session_token: String(b.session_token) } }];
}
return fallo(400, 'ACCION_INVALIDA', 'La acción debe ser login, logout o validar.');
`, [3, 1]);

  w.switchRuta('Según acción', ['login', 'sesion', 'error'], [4, 1]);

  // --- login ---
  w.code('Verificar password (hash + salt)', `
const crypto = require('crypto');
const v = $('Validar solicitud').first().json;
const u = filas('Leer Usuarios', 'usuario_id').find((x) => String(x.email_normalizado).trim().toLowerCase() === v.email);
const invalidas = () => fallo(401, 'CREDENCIALES_INVALIDAS', 'El email o la contraseña no coinciden.', { valido: false });
if (!u) return invalidas();
const calculado = crypto.pbkdf2Sync(v.password, String(u.password_salt), 100000, 32, 'sha256').toString('hex');
const guardado = String(u.password_hash);
if (calculado.length !== guardado.length || !crypto.timingSafeEqual(Buffer.from(calculado), Buffer.from(guardado))) return invalidas();
if (u.estado !== 'ACTIVO') return fallo(403, 'USUARIO_INACTIVO', 'Esta cuenta está desactivada.', { valido: false });
return [{ json: { valido: true, usuario: sinFila(u) } }];
`, [5, 0]);
  w.siVerdadero('¿Credenciales válidas?', 'valido', [6, 0]);
  w.code('Generar token de sesión', `
const crypto = require('crypto');
const u = $('Verificar password (hash + salt)').first().json.usuario;
const HORAS = 8;
const fila = {
  session_id: genId('SES'),
  usuario_id: u.usuario_id,
  session_token: crypto.randomBytes(32).toString('hex'),
  creada_en: ahora.toISOString(),
  expira_en: new Date(ahora.getTime() + HORAS * 3600 * 1000).toISOString(),
  estado: 'ACTIVA',
  cerrada_en: '',
  ultima_validacion: ahora.toISOString(),
};
return [{ json: { ...fila, _status: 200, _body: { ok: true, mensaje: 'Sesión iniciada.', data: { session_token: fila.session_token, expira_en: fila.expira_en, usuario: { usuario_id: u.usuario_id, nombre: u.nombre, email: u.email_normalizado } } } } }];
`, [7, 0]);
  w.agregarFila('Registrar sesión', 'EP02', 'Sesiones', [8, 0]);

  // --- logout / validar ---
  w.code('Validar sesión y expiración', `
const v = $('Validar solicitud').first().json;
const s = filas('Leer Sesiones', 'session_id').find((x) => x.session_token === v.session_token);
if (!s) return fallo(401, 'SESION_INVALIDA', 'Tu sesión no es válida. Inicia sesión de nuevo.', { actualizar: false });
const base = { session_id: s.session_id, ultima_validacion: ahora.toISOString() };
if (s.estado !== 'ACTIVA') {
  if (v.accion === 'logout') return ok(200, { estado: s.estado }, 'La sesión ya estaba cerrada.', { actualizar: false });
  return fallo(401, 'SESION_' + s.estado, 'Tu sesión terminó. Inicia sesión de nuevo.', { actualizar: false });
}
if (new Date(s.expira_en) <= ahora) {
  return fallo(401, 'SESION_EXPIRADA', 'Tu sesión expiró. Inicia sesión de nuevo.', { ...base, estado: 'EXPIRADA', actualizar: true });
}
const u = filas('Leer Usuarios', 'usuario_id').find((x) => x.usuario_id === s.usuario_id);
if (!u || u.estado !== 'ACTIVO') {
  return fallo(401, 'USUARIO_INACTIVO', 'Esta cuenta está desactivada.', { ...base, estado: 'CERRADA', cerrada_en: ahora.toISOString(), actualizar: true });
}
if (v.accion === 'logout') {
  return ok(200, { estado: 'CERRADA' }, 'Sesión cerrada.', { ...base, estado: 'CERRADA', cerrada_en: ahora.toISOString(), actualizar: true });
}
return ok(200, { valida: true, expira_en: s.expira_en, usuario: { usuario_id: u.usuario_id, nombre: u.nombre, email: u.email_normalizado } }, 'Sesión válida.', { ...base, actualizar: true });
`, [5, 2]);
  w.siVerdadero('¿Actualizar sesión?', 'actualizar', [6, 2]);
  w.actualizarFila('Actualizar estado de sesión', 'EP02', 'Sesiones', 'session_id', [7, 2]);

  w.armarRespuesta('Armar respuesta', ['Generar token de sesión', 'Verificar password (hash + salt)', 'Validar sesión y expiración', 'Validar solicitud'], [9, 1]);
  w.responder('Responder', [10, 1]);

  w.cadena('Webhook Auth', 'Leer Usuarios', 'Leer Sesiones', 'Validar solicitud', 'Según acción');
  w.unir('Según acción', 'Verificar password (hash + salt)', 0);
  w.unir('Según acción', 'Validar sesión y expiración', 1);
  w.unir('Según acción', 'Armar respuesta', 2);
  w.cadena('Verificar password (hash + salt)', '¿Credenciales válidas?');
  w.unir('¿Credenciales válidas?', 'Generar token de sesión', 0);
  w.unir('¿Credenciales válidas?', 'Armar respuesta', 1);
  w.cadena('Generar token de sesión', 'Registrar sesión', 'Armar respuesta');
  w.cadena('Validar sesión y expiración', '¿Actualizar sesión?');
  w.unir('¿Actualizar sesión?', 'Actualizar estado de sesión', 0);
  w.unir('¿Actualizar sesión?', 'Armar respuesta', 1);
  w.cadena('Actualizar estado de sesión', 'Armar respuesta', 'Responder');
  return w.json();
}
