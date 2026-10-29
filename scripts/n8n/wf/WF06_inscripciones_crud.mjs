import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF06 — Inscripciones CRUD', cfg);

  w.webhook('Webhook Inscripciones', 'eventpass/inscripciones', [0, 2]);
  w.leer('Leer Sesiones', 'EP02', 'Sesiones', [1, 2]);
  w.leer('Leer Usuarios', 'EP01', 'Usuarios', [2, 2]);
  w.leer('Leer Vinculaciones Telegram', 'EP03', 'Vinculaciones', [3, 2]);
  w.leer('Leer Eventos', 'EP04', 'Eventos', [4, 2]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [5, 2]);

  w.code('Validar sesión y solicitud', `
const b = $('Webhook Inscripciones').first().json.body || {};
const accion = String(b.accion || '').trim().toLowerCase();
const validas = ['crear', 'mis_inscripciones', 'actualizar', 'cancelar'];
if (!validas.includes(accion)) return fallo(400, 'ACCION_INVALIDA', 'La acción debe ser una de: ' + validas.join(', ') + '.');
const v = validarSesion(b.session_token, filas('Leer Sesiones', 'session_id'), filas('Leer Usuarios', 'usuario_id'));
if (!v.ok) return fallo(401, v.codigo, v.mensaje);
return [{ json: { ruta: accion, usuario: sinFila(v.usuario), body: b } }];
`, [6, 2]);
  w.switchRuta('Según operación', ['crear', 'mis_inscripciones', 'actualizar', 'cancelar', 'error'], [7, 2]);

  // --- crear ---
  w.code('Validar evento, Telegram y duplicado', `
const { usuario: u, body: b } = $('Validar sesión y solicitud').first().json;
const evento_id = String(b.evento_id || '').trim().toUpperCase();
const audit = (resultado, detalle, extra = {}) => ({ _auditoria: { inscripcion_id: '', usuario_id: u.usuario_id, evento_id, accion: 'CREAR', estado_anterior: '', estado_nuevo: '', resultado, detalle, ...extra } });
const no = (status, codigo, mensaje) => fallo(status, codigo, mensaje, { puede: false, ...audit('ERROR', codigo) });

const vinculado = filas('Leer Vinculaciones Telegram', 'vinculacion_id').some((x) => x.usuario_id === u.usuario_id && x.estado === 'ACTIVA');
if (!vinculado) return no(412, 'TELEGRAM_NO_VINCULADO', 'Vincula tu Telegram en Mi cuenta antes de inscribirte. Así te avisamos de cupos y recordatorios.');
const e = filas('Leer Eventos', 'evento_id').find((x) => String(x.evento_id).toUpperCase() === evento_id);
if (!e) return no(404, 'EVENTO_NO_ENCONTRADO', 'Ese evento no existe.');
if (e.estado !== 'PUBLICADO') return no(409, 'EVENTO_NO_DISPONIBLE', 'Este evento está ' + String(e.estado).toLowerCase() + ' y no recibe inscripciones.');
if (fechaEvento(e) <= ahora) return no(409, 'EVENTO_FINALIZADO', 'Este evento ya empezó o terminó.');

// Idempotencia: usuario_id + evento_id no puede tener dos inscripciones activas.
const activa = filas('Leer Inscripciones', 'inscripcion_id').find((i) => i.usuario_id === u.usuario_id && i.evento_id === e.evento_id && ['CONFIRMADA', 'LISTA_ESPERA', 'ASISTIO'].includes(i.estado));
if (activa) return ok(200, { inscripcion: sinFila(activa), ya_existia: true }, activa.estado === 'LISTA_ESPERA' ? 'Ya estás en la lista de espera de este evento.' : activa.estado === 'ASISTIO' ? 'Ya registraste tu ingreso a este evento.' : 'Ya tienes tu cupo confirmado en este evento.', { puede: false, ...audit('OMITIDO', 'Inscripción activa existente (idempotencia)', { inscripcion_id: activa.inscripcion_id, estado_anterior: activa.estado, estado_nuevo: activa.estado }) });
return [{ json: { puede: true, evento: sinFila(e) } }];
`, [8, 0]);
  w.siVerdadero('¿Puede inscribirse?', 'puede', [9, 0]);
  w.code('Calcular cupos y asignar estado', `
const { usuario: u, body: b } = $('Validar sesión y solicitud').first().json;
const e = $('Validar evento, Telegram y duplicado').first().json.evento;
const delEvento = filas('Leer Inscripciones', 'inscripcion_id').filter((i) => i.evento_id === e.evento_id);
const confirmadas = delEvento.filter((i) => ['CONFIRMADA', 'ASISTIO'].includes(i.estado)).length;
const enEspera = delEvento.filter((i) => i.estado === 'LISTA_ESPERA').length;
const hayCupo = confirmadas < Number(e.capacidad);
const estado = hayCupo ? 'CONFIRMADA' : 'LISTA_ESPERA';
const fecha = ahora.toISOString();
const fila = {
  inscripcion_id: genId('INS'), usuario_id: u.usuario_id, evento_id: e.evento_id, estado,
  fecha_inscripcion: fecha, fecha_actualizacion: fecha,
  nombre_acreditacion: String(b.nombre_acreditacion || u.nombre).trim().slice(0, 80),
  observaciones: String(b.observaciones || '').trim().slice(0, 300),
  origen: 'WEB', orden_espera: hayCupo ? '' : String(enEspera + 1),
};
const titulo = hayCupo ? 'Cupo confirmado: ' + e.nombre : 'Estás en lista de espera: ' + e.nombre;
const mensaje = hayCupo
  ? 'Tu cupo para ' + e.nombre + ' está confirmado. Te esperamos el ' + e.fecha + ' a las ' + e.hora + ' en ' + e.lugar + '.'
  : 'El evento ' + e.nombre + ' está lleno. Quedaste en la posición ' + fila.orden_espera + ' de la lista de espera; si se libera un cupo te lo asignamos automáticamente y te avisamos.';
return [{ json: { ...fila, _status: 201,
  _body: { ok: true, mensaje: hayCupo ? 'Inscripción confirmada.' : 'El evento está lleno: quedaste en lista de espera (posición ' + fila.orden_espera + ').', data: { inscripcion: fila, cupos_restantes: Math.max(Number(e.capacidad) - confirmadas - (hayCupo ? 1 : 0), 0) } },
  _auditoria: { inscripcion_id: fila.inscripcion_id, usuario_id: u.usuario_id, evento_id: e.evento_id, accion: 'CREAR', estado_anterior: '', estado_nuevo: estado, resultado: 'OK', detalle: hayCupo ? 'Cupo disponible' : 'Sin cupo: lista de espera' },
  _notificacion: { usuario_id: u.usuario_id, tipo: hayCupo ? 'INSCRIPCION_CONFIRMADA' : 'LISTA_ESPERA', titulo, mensaje, evento_id: e.evento_id, inscripcion_id: fila.inscripcion_id } } }];
`, [10, 0]);
  w.agregarFila('Guardar inscripción', 'EP06', 'Inscripciones', [11, 0]);

  // --- mis_inscripciones ---
  w.code('Listar inscripciones del usuario', `
const { usuario: u } = $('Validar sesión y solicitud').first().json;
const eventos = Object.fromEntries(filas('Leer Eventos', 'evento_id').map((e) => [e.evento_id, e]));
const lista = filas('Leer Inscripciones', 'inscripcion_id').filter((i) => i.usuario_id === u.usuario_id).map((i) => {
  const e = eventos[i.evento_id] || {};
  return { ...sinFila(i), evento: { evento_id: e.evento_id, nombre: e.nombre, categoria: e.categoria, fecha: String(e.fecha || '').slice(0, 10), hora: e.hora, lugar: e.lugar, estado: e.estado, imagen_url: e.imagen_url } };
}).sort((a, b) => String(b.fecha_inscripcion).localeCompare(String(a.fecha_inscripcion)));
return ok(200, { inscripciones: lista }, lista.length + ' inscripciones.');
`, [8, 1]);

  // --- actualizar (solo campos permitidos) ---
  w.code('Preparar actualización', `
const { usuario: u, body: b } = $('Validar sesión y solicitud').first().json;
const i = filas('Leer Inscripciones', 'inscripcion_id').find((x) => x.inscripcion_id === String(b.inscripcion_id || '') && x.usuario_id === u.usuario_id);
const audit = (resultado, detalle) => ({ _auditoria: { inscripcion_id: i ? i.inscripcion_id : String(b.inscripcion_id || ''), usuario_id: u.usuario_id, evento_id: i ? i.evento_id : '', accion: 'ACTUALIZAR', estado_anterior: i ? i.estado : '', estado_nuevo: i ? i.estado : '', resultado, detalle } });
if (!i) return fallo(404, 'INSCRIPCION_NO_ENCONTRADA', 'No encontramos esa inscripción en tu cuenta.', { aplicar: false, ...audit('ERROR', 'No encontrada') });
if (i.estado === 'CANCELADA') return fallo(409, 'INSCRIPCION_CANCELADA', 'Una inscripción cancelada no se puede editar.', { aplicar: false, ...audit('ERROR', 'Cancelada') });
const cambios = {};
if (b.nombre_acreditacion !== undefined) { const n = String(b.nombre_acreditacion).trim(); if (n.length < 2 || n.length > 80) return fallo(400, 'NOMBRE_INVALIDO', 'El nombre de la credencial debe tener entre 2 y 80 caracteres.', { aplicar: false }); cambios.nombre_acreditacion = n; }
if (b.observaciones !== undefined) cambios.observaciones = String(b.observaciones).trim().slice(0, 300);
if (!Object.keys(cambios).length) return fallo(400, 'SIN_CAMBIOS', 'Solo puedes cambiar el nombre de la credencial y las observaciones.', { aplicar: false });
const fila = { inscripcion_id: i.inscripcion_id, ...cambios, fecha_actualizacion: ahora.toISOString() };
return [{ json: { ...fila, aplicar: true, _status: 200, _body: { ok: true, mensaje: 'Inscripción actualizada.', data: { inscripcion: { ...sinFila(i), ...fila } } }, ...audit('OK', 'Campos: ' + Object.keys(cambios).join(', ')) } }];
`, [8, 2]);

  // --- cancelar (borrado lógico) ---
  w.code('Preparar cancelación', `
const { usuario: u, body: b } = $('Validar sesión y solicitud').first().json;
const i = filas('Leer Inscripciones', 'inscripcion_id').find((x) => x.inscripcion_id === String(b.inscripcion_id || '') && x.usuario_id === u.usuario_id);
if (!i) return fallo(404, 'INSCRIPCION_NO_ENCONTRADA', 'No encontramos esa inscripción en tu cuenta.', { aplicar: false });
const e = filas('Leer Eventos', 'evento_id').find((x) => x.evento_id === i.evento_id) || {};
const audit = (resultado, detalle) => ({ _auditoria: { inscripcion_id: i.inscripcion_id, usuario_id: u.usuario_id, evento_id: i.evento_id, accion: 'CANCELAR', estado_anterior: i.estado, estado_nuevo: resultado === 'OK' ? 'CANCELADA' : i.estado, resultado, detalle } });
if (i.estado === 'CANCELADA') return ok(200, { inscripcion: sinFila(i), ya_existia: true }, 'Esta inscripción ya estaba cancelada.', { aplicar: false, ...audit('OMITIDO', 'Ya cancelada (idempotencia)') });
if (i.estado === 'ASISTIO') return fallo(409, 'INSCRIPCION_ASISTIO', 'Ya registraste tu ingreso a este evento; la inscripción no se puede cancelar.', { aplicar: false, ...audit('ERROR', 'Asistencia registrada (check-in)') });
if (e.evento_id && fechaEvento(e) <= ahora) return fallo(409, 'EVENTO_FINALIZADO', 'El evento ya empezó; la inscripción no se puede cancelar.', { aplicar: false, ...audit('ERROR', 'Evento iniciado') });
const fila = { inscripcion_id: i.inscripcion_id, estado: 'CANCELADA', orden_espera: '', fecha_actualizacion: ahora.toISOString() };
const liberaCupo = i.estado === 'CONFIRMADA';
return [{ json: { ...fila, aplicar: true, _status: 200,
  _body: { ok: true, mensaje: liberaCupo ? 'Inscripción cancelada. Tu cupo pasará a la siguiente persona en lista de espera.' : 'Saliste de la lista de espera.', data: { inscripcion: { ...sinFila(i), ...fila } } },
  ...audit('OK', liberaCupo ? 'Libera cupo confirmado' : 'Sale de lista de espera'),
  _notificacion: { usuario_id: u.usuario_id, tipo: 'INSCRIPCION_CANCELADA', titulo: 'Cancelaste tu inscripción: ' + (e.nombre || i.evento_id), mensaje: 'Tu inscripción a ' + (e.nombre || i.evento_id) + ' quedó cancelada. Si fue un error, puedes inscribirte de nuevo mientras haya cupo o lista de espera.', evento_id: i.evento_id, inscripcion_id: i.inscripcion_id } } }];
`, [8, 3]);

  w.siVerdadero('¿Aplicar cambios?', 'aplicar', [9, 2]);
  w.actualizarFila('Actualizar inscripción', 'EP06', 'Inscripciones', 'inscripcion_id', [10, 2]);

  w.armarRespuesta('Armar respuesta', ['Calcular cupos y asignar estado', 'Validar evento, Telegram y duplicado', 'Preparar actualización', 'Preparar cancelación', 'Listar inscripciones del usuario', 'Validar sesión y solicitud'], [12, 2]);
  w.responder('Responder', [13, 2]);

  w.code('Fila de auditoría', `
const a = $('Armar respuesta').first().json._auditoria;
if (!a) return [];
return [{ json: { auditoria_id: genId('AUD'), ...a, fecha: ahora.toISOString() } }];
`, [14, 1]);
  w.agregarFila('Registrar auditoría', 'EP06', 'Auditoria_Inscripciones', [15, 1]);

  w.code('Preparar notificación', `
const n = $('Armar respuesta').first().json._notificacion;
if (!n) return [];
return [{ json: { ...n, clave_idempotencia: n.tipo + '|' + n.inscripcion_id } }];
`, [14, 3]);
  w.notificar('Notificar (WF09)', [15, 3]);

  w.cadena('Webhook Inscripciones', 'Leer Sesiones', 'Leer Usuarios', 'Leer Vinculaciones Telegram', 'Leer Eventos', 'Leer Inscripciones', 'Validar sesión y solicitud', 'Según operación');
  w.unir('Según operación', 'Validar evento, Telegram y duplicado', 0);
  w.unir('Según operación', 'Listar inscripciones del usuario', 1);
  w.unir('Según operación', 'Preparar actualización', 2);
  w.unir('Según operación', 'Preparar cancelación', 3);
  w.unir('Según operación', 'Armar respuesta', 4);
  w.cadena('Validar evento, Telegram y duplicado', '¿Puede inscribirse?');
  w.unir('¿Puede inscribirse?', 'Calcular cupos y asignar estado', 0);
  w.unir('¿Puede inscribirse?', 'Armar respuesta', 1);
  w.cadena('Calcular cupos y asignar estado', 'Guardar inscripción', 'Armar respuesta');
  w.cadena('Listar inscripciones del usuario', 'Armar respuesta');
  w.cadena('Preparar actualización', '¿Aplicar cambios?');
  w.cadena('Preparar cancelación', '¿Aplicar cambios?');
  w.unir('¿Aplicar cambios?', 'Actualizar inscripción', 0);
  w.unir('¿Aplicar cambios?', 'Armar respuesta', 1);
  w.cadena('Actualizar inscripción', 'Armar respuesta', 'Responder');
  w.cadena('Responder', 'Fila de auditoría', 'Registrar auditoría');
  w.cadena('Responder', 'Preparar notificación', 'Notificar (WF09)');
  return w.json();
}
