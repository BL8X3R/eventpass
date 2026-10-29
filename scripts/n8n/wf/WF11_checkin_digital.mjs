import { crearWorkflow } from '../lib.mjs';

// Examen: check-in digital. Registra el ingreso real de una persona a un evento.
// Cada intento (EXITOSO, DUPLICADO o RECHAZADO) queda en EP11_Checkin > Checkins.
export default function (cfg) {
  const w = crearWorkflow('WF11 — Check-in digital', cfg);

  w.webhook('Webhook Check-in', 'eventpass/checkin', [0, 2]);
  w.leer('Leer inscripción', 'EP06', 'Inscripciones', [1, 2]);
  w.leer('Leer evento', 'EP04', 'Eventos', [2, 2]);
  w.leer('Leer historial de check-in', 'EP11', 'Checkins', [3, 2]);

  // Cada validación deja pasar el item sin tocarlo si una validación anterior ya decidió el resultado.
  w.code('Validar solicitud', `
const b = $('Webhook Check-in').first().json.body || {};
const inscripcion_id = String(b.inscripcion_id || '').trim().toUpperCase();
const evento_id = String(b.evento_id || '').trim().toUpperCase();
const d = { inscripcion_id, evento_id, usuario_id: '', inscripcion: null, evento: null };
if (!inscripcion_id || !evento_id) {
  const mensaje = 'Escribe el código de la inscripción y el código del evento.';
  return [{ json: { ...d, resultado: 'RECHAZADO', detalle: 'DATOS_INVALIDOS: ' + mensaje, _status: 400, _body: { ok: false, resultado: 'RECHAZADO', error: { codigo: 'DATOS_INVALIDOS', mensaje } } } }];
}
return [{ json: d }];
`, [4, 2]);

  w.code('Validar inscripción y evento', `
const d = $json;
if (d.resultado) return [{ json: d }];
const rechazar = (status, codigo, mensaje) => [{ json: { ...d, resultado: 'RECHAZADO', detalle: codigo + ': ' + mensaje, _status: status, _body: { ok: false, resultado: 'RECHAZADO', error: { codigo, mensaje } } } }];

const i = filas('Leer inscripción', 'inscripcion_id').find((x) => String(x.inscripcion_id).toUpperCase() === d.inscripcion_id);
if (!i) return rechazar(404, 'INSCRIPCION_NO_ENCONTRADA', 'No existe una inscripción con el código ' + d.inscripcion_id + '.');
d.inscripcion = sinFila(i);
d.usuario_id = i.usuario_id;

const e = filas('Leer evento', 'evento_id').find((x) => String(x.evento_id).toUpperCase() === d.evento_id);
if (!e) return rechazar(404, 'EVENTO_NO_ENCONTRADO', 'No existe un evento con el código ' + d.evento_id + '.');
d.evento = sinFila(e);
if (e.estado === 'CANCELADO') return rechazar(409, 'EVENTO_CANCELADO', 'El evento ' + e.nombre + ' fue cancelado; no recibe ingresos.');

// Correspondencia: la inscripción tiene que ser de este mismo evento.
if (String(i.evento_id).toUpperCase() !== d.evento_id) return rechazar(409, 'EVENTO_NO_CORRESPONDE', 'Esta inscripción es del evento ' + i.evento_id + ', no de ' + d.evento_id + '.');
return [{ json: d }];
`, [5, 2]);

  w.code('Validar duplicado', `
const d = $json;
if (d.resultado) return [{ json: d }];
// Se revisa el historial y también el estado, por si la hoja de check-in y la inscripción no coinciden.
const previo = filas('Leer historial de check-in', 'checkin_id').find((c) => c.inscripcion_id === d.inscripcion.inscripcion_id && c.resultado === 'EXITOSO');
if (previo || d.inscripcion.estado === 'ASISTIO') {
  const cuando = previo ? new Date(previo.fecha_checkin).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '';
  const mensaje = 'El ingreso ya había sido registrado' + (cuando ? ' (' + cuando + ')' : '') + '.';
  return [{ json: { ...d, resultado: 'DUPLICADO', detalle: 'CHECKIN_DUPLICADO: ' + (previo ? 'check-in previo ' + previo.checkin_id : 'la inscripción ya estaba en ASISTIO'), _status: 409,
    _body: { ok: false, resultado: 'DUPLICADO', error: { codigo: 'CHECKIN_DUPLICADO', mensaje }, data: { checkin_previo: previo ? sinFila(previo) : null } } } }];
}
return [{ json: d }];
`, [6, 2]);

  w.code('Validar estado CONFIRMADA', `
const d = $json;
if (d.resultado) return [{ json: d }];
const estado = d.inscripcion.estado;
if (estado !== 'CONFIRMADA') {
  const motivos = {
    LISTA_ESPERA: 'La inscripción está en lista de espera: todavía no tiene cupo en el evento.',
    CANCELADA: 'La inscripción fue cancelada.',
  };
  const mensaje = motivos[estado] || 'La inscripción está en estado ' + estado + ' y no permite el ingreso.';
  return [{ json: { ...d, resultado: 'RECHAZADO', detalle: 'INSCRIPCION_NO_CONFIRMADA (' + estado + '): ' + mensaje, _status: 409, _body: { ok: false, resultado: 'RECHAZADO', error: { codigo: 'INSCRIPCION_NO_CONFIRMADA', mensaje } } } }];
}
return [{ json: { ...d, resultado: 'EXITOSO' } }];
`, [7, 2]);
  w.switchRuta('Según resultado', ['EXITOSO', 'DUPLICADO', 'RECHAZADO'], [8, 2], 'resultado');

  // --- EXITOSO ---
  w.code('Generar checkin_id', `
const d = $json;
// El checkin_id exitoso sale de la inscripción: si llegan dos solicitudes casi a la vez, ambas escriben
// la misma fila (appendOrUpdate por checkin_id) en vez de crear dos check-ins EXITOSO.
const fila = {
  checkin_id: 'CHK-' + d.inscripcion.inscripcion_id,
  inscripcion_id: d.inscripcion.inscripcion_id,
  evento_id: d.evento.evento_id,
  usuario_id: d.usuario_id,
  fecha_checkin: ahora.toISOString(),
  resultado: 'EXITOSO',
  detalle: 'Ingreso registrado. Estado CONFIRMADA -> ASISTIO',
};
const e = d.evento;
const nombre = d.inscripcion.nombre_acreditacion || '';
return [{ json: { ...fila, _status: 201,
  _body: { ok: true, resultado: 'EXITOSO', mensaje: 'Check-in realizado correctamente.', data: { checkin: fila, nombre_acreditacion: nombre, evento: { evento_id: e.evento_id, nombre: e.nombre, lugar: e.lugar } } },
  _notificacion: { usuario_id: d.usuario_id, tipo: 'CHECKIN_EXITOSO', titulo: 'Ingreso registrado: ' + e.nombre,
    mensaje: 'Registramos tu ingreso a ' + e.nombre + ' (' + e.lugar + ') el ' + ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + '. ¡Disfruta el evento!',
    evento_id: e.evento_id, inscripcion_id: d.inscripcion.inscripcion_id } } }];
`, [9, 1]);
  w.agregarOActualizarFila('Registrar check-in (EP11)', 'EP11', 'Checkins', 'checkin_id', [10, 1]);
  w.code('Preparar inscripción ASISTIO', `
const c = $('Generar checkin_id').first().json;
// Solo se envía la fila de esta inscripción; el update busca por inscripcion_id.
return [{ json: { inscripcion_id: c.inscripcion_id, estado: 'ASISTIO', fecha_actualizacion: c.fecha_checkin } }];
`, [11, 1]);
  w.actualizarFila('Actualizar inscripción a ASISTIO', 'EP06', 'Inscripciones', 'inscripcion_id', [12, 1]);

  // --- DUPLICADO / RECHAZADO: igual se deja registro del intento ---
  w.code('Preparar registro del intento', `
const d = $json;
return [{ json: { checkin_id: genId('CHK'), inscripcion_id: d.inscripcion_id, evento_id: d.evento_id, usuario_id: d.usuario_id || '',
  fecha_checkin: ahora.toISOString(), resultado: d.resultado, detalle: String(d.detalle || '').slice(0, 300) } }];
`, [9, 3]);
  w.agregarFila('Registrar intento (EP11)', 'EP11', 'Checkins', [10, 3]);

  w.armarRespuesta('Armar respuesta', ['Generar checkin_id', 'Validar estado CONFIRMADA'], [13, 2]);
  w.responder('Responder', [14, 2]);

  w.code('Preparar notificación', `
const n = $('Armar respuesta').first().json._notificacion;
if (!n) return [];
return [{ json: { ...n, clave_idempotencia: n.tipo + '|' + n.inscripcion_id } }];
`, [15, 2]);
  w.notificar('Notificar (WF09)', [16, 2]);

  w.cadena('Webhook Check-in', 'Leer inscripción', 'Leer evento', 'Leer historial de check-in', 'Validar solicitud', 'Validar inscripción y evento', 'Validar duplicado', 'Validar estado CONFIRMADA', 'Según resultado');
  w.unir('Según resultado', 'Generar checkin_id', 0);
  w.unir('Según resultado', 'Preparar registro del intento', 1);
  w.unir('Según resultado', 'Preparar registro del intento', 2);
  w.cadena('Generar checkin_id', 'Registrar check-in (EP11)', 'Preparar inscripción ASISTIO', 'Actualizar inscripción a ASISTIO', 'Armar respuesta');
  w.cadena('Preparar registro del intento', 'Registrar intento (EP11)', 'Armar respuesta');
  w.cadena('Armar respuesta', 'Responder', 'Preparar notificación', 'Notificar (WF09)');
  return w.json();
}
