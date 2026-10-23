import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF01 — Usuarios CRUD', cfg);

  w.webhook('Webhook Usuarios', 'eventpass/usuarios', [0, 2]);
  w.leer('Leer Usuarios', 'EP01', 'Usuarios', [1, 2]);
  w.leer('Leer Sesiones', 'EP02', 'Sesiones', [2, 2]);

  w.code('Validar solicitud', `
const b = $('Webhook Usuarios').first().json.body || {};
const accion = String(b.accion || '').trim().toLowerCase();
const validas = ['crear', 'perfil', 'actualizar', 'desactivar'];
if (!validas.includes(accion)) return fallo(400, 'ACCION_INVALIDA', 'La acción debe ser una de: ' + validas.join(', ') + '.');

if (accion === 'crear') {
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const errores = [];
  if (nombre.length < 2 || nombre.length > 80) errores.push('el nombre debe tener entre 2 y 80 caracteres');
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) errores.push('el email no tiene un formato válido');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) errores.push('la contraseña necesita mínimo 8 caracteres, con letras y números');
  if (errores.length) return fallo(400, 'DATOS_INVALIDOS', 'Revisa los datos: ' + errores.join('; ') + '.', { _auditoria: { usuario_id: '', accion: 'CREAR', resultado: 'ERROR', detalle: errores.join('; ') } });
  return [{ json: { ruta: 'crear', nombre, email_normalizado: email, password } }];
}

const v = validarSesion(b.session_token, filas('Leer Sesiones', 'session_id'), filas('Leer Usuarios', 'usuario_id'));
if (!v.ok) return fallo(401, v.codigo, v.mensaje);
return [{ json: { ruta: accion, usuario: sinFila(v.usuario), body: b } }];
`, [3, 2]);

  w.switchRuta('Según operación', ['crear', 'perfil', 'actualizar', 'desactivar', 'error'], [4, 2]);

  // --- crear ---
  w.code('Control email duplicado', `
const v = $('Validar solicitud').first().json;
const existe = filas('Leer Usuarios', 'usuario_id').some((u) => String(u.email_normalizado).trim().toLowerCase() === v.email_normalizado);
if (existe) return fallo(409, 'EMAIL_DUPLICADO', 'Ya existe una cuenta con ese email. Inicia sesión o usa otro email.', { duplicado: true, _auditoria: { usuario_id: '', accion: 'CREAR', resultado: 'ERROR', detalle: 'Email duplicado: ' + v.email_normalizado } });
return [{ json: { duplicado: false } }];
`, [5, 0]);
  w.siVerdadero('¿Email duplicado?', 'duplicado', [6, 0]);
  w.code('Generar hash, salt y usuario_id', `
const crypto = require('crypto');
const v = $('Validar solicitud').first().json;
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(v.password, salt, 100000, 32, 'sha256').toString('hex');
const usuario_id = genId('USR');
const fecha = ahora.toISOString();
const fila = { usuario_id, nombre: v.nombre, email_normalizado: v.email_normalizado, password_hash: hash, password_salt: salt, estado: 'ACTIVO', fecha_registro: fecha, fecha_actualizacion: fecha };
return [{ json: { ...fila, _status: 201,
  _body: { ok: true, mensaje: 'Cuenta creada. Ya puedes iniciar sesión.', data: { usuario_id, nombre: v.nombre, email: v.email_normalizado, estado: 'ACTIVO' } },
  _auditoria: { usuario_id, accion: 'CREAR', resultado: 'OK', detalle: 'Usuario registrado' } } }];
`, [7, 0]);
  w.agregarFila('Crear usuario', 'EP01', 'Usuarios', [8, 0]);

  // --- perfil ---
  w.code('Consultar perfil', `
const u = $('Validar solicitud').first().json.usuario;
return ok(200, { usuario_id: u.usuario_id, nombre: u.nombre, email: u.email_normalizado, estado: u.estado, fecha_registro: u.fecha_registro, fecha_actualizacion: u.fecha_actualizacion }, 'Perfil consultado.');
`, [5, 1]);

  // --- actualizar ---
  w.code('Preparar actualización', `
const crypto = require('crypto');
const { usuario: u, body: b } = $('Validar solicitud').first().json;
const verificar = (pw) => crypto.timingSafeEqual(Buffer.from(crypto.pbkdf2Sync(String(pw || ''), u.password_salt, 100000, 32, 'sha256').toString('hex')), Buffer.from(String(u.password_hash)));
const cambios = {};
if (b.nombre !== undefined && String(b.nombre).trim() !== u.nombre) {
  const n = String(b.nombre).trim();
  if (n.length < 2 || n.length > 80) return fallo(400, 'NOMBRE_INVALIDO', 'El nombre debe tener entre 2 y 80 caracteres.', { aplicar: false });
  cambios.nombre = n;
}
if (b.password_nueva) {
  const p = String(b.password_nueva);
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return fallo(400, 'PASSWORD_DEBIL', 'La nueva contraseña necesita mínimo 8 caracteres, con letras y números.', { aplicar: false });
  if (!verificar(b.password_actual)) return fallo(403, 'PASSWORD_INCORRECTA', 'La contraseña actual no coincide.', { aplicar: false, _auditoria: { usuario_id: u.usuario_id, accion: 'ACTUALIZAR', resultado: 'ERROR', detalle: 'Contraseña actual incorrecta' } });
  cambios.password_salt = crypto.randomBytes(16).toString('hex');
  cambios.password_hash = crypto.pbkdf2Sync(p, cambios.password_salt, 100000, 32, 'sha256').toString('hex');
}
if (!Object.keys(cambios).length) return fallo(400, 'SIN_CAMBIOS', 'No hay cambios para guardar. Puedes cambiar tu nombre o tu contraseña.', { aplicar: false });
const campos = Object.keys(cambios).filter((k) => k !== 'password_salt').map((k) => k === 'password_hash' ? 'contraseña' : k);
return [{ json: { usuario_id: u.usuario_id, ...cambios, fecha_actualizacion: ahora.toISOString(), aplicar: true, _status: 200,
  _body: { ok: true, mensaje: 'Perfil actualizado.', data: { usuario_id: u.usuario_id, nombre: cambios.nombre || u.nombre, email: u.email_normalizado } },
  _auditoria: { usuario_id: u.usuario_id, accion: 'ACTUALIZAR', resultado: 'OK', detalle: 'Campos: ' + campos.join(', ') } } }];
`, [5, 2]);

  // --- desactivar (borrado lógico) ---
  w.code('Preparar desactivación', `
const crypto = require('crypto');
const { usuario: u, body: b } = $('Validar solicitud').first().json;
const hash = crypto.pbkdf2Sync(String(b.password || ''), u.password_salt, 100000, 32, 'sha256').toString('hex');
if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(u.password_hash)))) return fallo(403, 'PASSWORD_INCORRECTA', 'Escribe tu contraseña actual para desactivar la cuenta.', { aplicar: false });
return [{ json: { usuario_id: u.usuario_id, estado: 'INACTIVO', fecha_actualizacion: ahora.toISOString(), aplicar: true, _status: 200,
  _body: { ok: true, mensaje: 'Cuenta desactivada. Tus datos se conservan, pero ya no podrás iniciar sesión.', data: { usuario_id: u.usuario_id, estado: 'INACTIVO' } },
  _auditoria: { usuario_id: u.usuario_id, accion: 'DESACTIVAR', resultado: 'OK', detalle: 'Borrado lógico: estado INACTIVO' } } }];
`, [5, 3]);

  w.siVerdadero('¿Aplicar cambios?', 'aplicar', [6, 2]);
  w.actualizarFila('Actualizar usuario', 'EP01', 'Usuarios', 'usuario_id', [7, 2]);

  w.armarRespuesta('Armar respuesta', ['Generar hash, salt y usuario_id', 'Control email duplicado', 'Preparar actualización', 'Preparar desactivación', 'Consultar perfil', 'Validar solicitud'], [9, 2]);
  w.responder('Responder', [10, 2]);
  w.code('Fila de auditoría', `
const a = $('Armar respuesta').first().json._auditoria;
if (!a) return [];
return [{ json: { auditoria_id: genId('AUD'), usuario_id: a.usuario_id || '', accion: a.accion, fecha: ahora.toISOString(), resultado: a.resultado, detalle: a.detalle || '' } }];
`, [11, 2]);
  w.agregarFila('Registrar auditoría', 'EP01', 'Auditoria_Usuarios', [12, 2]);

  w.cadena('Webhook Usuarios', 'Leer Usuarios', 'Leer Sesiones', 'Validar solicitud', 'Según operación');
  w.unir('Según operación', 'Control email duplicado', 0);
  w.unir('Según operación', 'Consultar perfil', 1);
  w.unir('Según operación', 'Preparar actualización', 2);
  w.unir('Según operación', 'Preparar desactivación', 3);
  w.unir('Según operación', 'Armar respuesta', 4);
  w.cadena('Control email duplicado', '¿Email duplicado?');
  w.unir('¿Email duplicado?', 'Armar respuesta', 0);
  w.unir('¿Email duplicado?', 'Generar hash, salt y usuario_id', 1);
  w.cadena('Generar hash, salt y usuario_id', 'Crear usuario', 'Armar respuesta');
  w.cadena('Consultar perfil', 'Armar respuesta');
  w.cadena('Preparar actualización', '¿Aplicar cambios?');
  w.cadena('Preparar desactivación', '¿Aplicar cambios?');
  w.unir('¿Aplicar cambios?', 'Actualizar usuario', 0);
  w.unir('¿Aplicar cambios?', 'Armar respuesta', 1);
  w.cadena('Actualizar usuario', 'Armar respuesta', 'Responder', 'Fila de auditoría', 'Registrar auditoría');
  return w.json();
}
