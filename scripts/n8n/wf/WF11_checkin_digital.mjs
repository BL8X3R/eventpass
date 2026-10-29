import { crearWorkflow } from '../lib.mjs';

// Examen: check-in digital. Registra el ingreso real de un asistente al evento.
// Cada intento (EXITOSO, DUPLICADO o RECHAZADO) queda en EP11_Checkin/Checkins.
export default function (cfg) {
  const w = crearWorkflow('WF11 — Check-in digital', cfg);

  w.webhook('Webhook Check-in', 'eventpass/checkin', [0, 2]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [1, 2]);
  w.leer('Leer Eventos', 'EP04', 'Eventos', [2, 2]);
  w.leer('Leer historial de check-in', 'EP11', 'Checkins', [3, 2]);

  // Cada validación deja pasar el item con `valido`. Si falla, fija resultado y respuesta HTTP.
  w.code('Validar existencia', `
const b = $('Webhook Check-in').first().json.body || {};
const inscripcion_id = String(b.inscripcion_id || '').trim().toUpperCase();
const evento_id = String(b.evento_id || '').trim().toUpperCase();
const base = { inscripcion_id, evento_id, usuario_id: '', origen: String(b.origen || 'WEB').slice(0, 20) };
const no = (status, codigo, mensaje) => [{ json: { ...base, valido: false, resultado: 'RECHAZADO', detalle: codigo, _status: status, _mensaje: mensaje, _codigo: codigo } }];
if (!inscripcion_id || !evento_id) return no(400, 'DATOS_INCOMPLETOS', 'Indica el ID de la inscripción y el ID del evento.');
const i = filas('Leer Inscripciones', 'inscripcion_id').find((x) => String(x.inscripcion_id).toUpperCase() === inscripcion_id);
if (!i) return no(404, 'INSCRIPCION_NO_ENCONTRADA', 'No existe una inscripción con el ID ' + inscripcion_id + '.');
base.usuario_id = i.usuario_id;
const e = filas('Leer Eventos', 'evento_id').find((x) => String(x.evento_id).toUpperCase() === evento_id);
if (!e) return no(404, 'EVENTO_NO_ENCONTRADO', 'No existe un evento con el ID ' + evento_id + '.');
if (!['PUBLICADO', 'CERRADO'].includes(e.estado)) return no(409, 'EVENTO_' + e.estado, 'El evento está ' + String(e.estado).toLowerCase() + '; no se registran ingresos.');
return [{ json: { ...base, valido: true, inscripcion: sinFila(i), evento: sinFila(e) } }];
`, [4, 2]);
  w.siVerdadero('¿Existen inscripción y evento?', 'valido', [5, 2]);

  w.code('Validar correspondencia inscripción-evento', `
const r = $input.first().json;
if (String(r.inscripcion.evento_id).toUpperCase() !== r.evento_id) {
  return [{ json: { ...r, valido: false, resultado: 'RECHAZADO', detalle: 'EVENTO_NO_CORRESPONDE: la inscripción es de ' + r.inscripcion.evento_id,
    _status: 409, _codigo: 'EVENTO_NO_CORRESPONDE', _mensaje: 'Esta inscripción pertenece a otro evento (' + r.inscripcion.evento_id + '), no a ' + r.evento_id + '.' } }];
}
return [{ json: r }];
`, [6, 1]);
  w.siVerdadero('¿Corresponde al evento?', 'valido', [7, 1]);

  // Idempotencia: un check-in EXITOSO previo en EP11 o el estado ASISTIO en EP06 bloquean un segundo ingreso.
  w.code('Validar duplicado', `
const r = $input.first().json;
const previo = filas('Leer historial de check-in', 'checkin_id')
  .find((c) => String(c.inscripcion_id).toUpperCase() === r.inscripcion_id && c.resultado === 'EXITOSO');
if (previo || r.inscripcion.estado === 'ASISTIO') {
  const cuando = previo ? new Date(previo.fecha_checkin).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '';
  return [{ json: { ...r, valido: false, resultado: 'DUPLICADO', detalle: 'Ya registrado' + (previo ? ' en ' + previo.checkin_id : ' (estado ASISTIO)'),
    checkin_original: previo ? { checkin_id: previo.checkin_id, fecha_checkin: previo.fecha_checkin } : null,
    _status: 409, _codigo: 'CHECKIN_DUPLICADO', _mensaje: 'El ingreso ya había sido registrado' + (cuando ? ' (' + cuando + ')' : '') + '.' } }];
}
return [{ json: r }];
`, [8, 0]);
  w.siVerdadero('¿Es el primer ingreso?', 'valido', [9, 0]);

  w.code('Validar estado CONFIRMADA', `
const r = $input.first().json;
const estado = r.inscripcion.estado;
if (estado !== 'CONFIRMADA') {
  const motivo = { LISTA_ESPERA: 'está en lista de espera y no tiene cupo', CANCELADA: 'está cancelada' }[estado] || 'tiene estado ' + estado;
  return [{ json: { ...r, valido: false, resultado: 'RECHAZADO', detalle: 'INSCRIPCION_' + estado,
    _status: 409, _codigo: 'INSCRIPCION_' + estado, _mensaje: 'No se permite el ingreso: la inscripción ' + motivo + '.' } }];
}
return [{ json: { ...r, valido: true, resultado: 'EXITOSO', detalle: 'Ingreso registrado; inscripción CONFIRMADA -> ASISTIO', _status: 200, _mensaje: 'Check-in realizado correctamente.' } }];
`, [10, 0]);

  w.code('Generar checkin_id', `
const r = $input.first().json;
const fila = { checkin_id: genId('CHK'), inscripcion_id: r.inscripcion_id, evento_id: r.evento_id, usuario_id: r.usuario_id,
  fecha_checkin: ahora.toISOString(), resultado: r.resultado, detalle: String(r.detalle || '').slice(0, 300) };
const e = r.evento || {};
const data = { ...fila, estado_inscripcion: r.resultado === 'EXITOSO' ? 'ASISTIO' : (r.inscripcion?.estado || ''),
  evento: e.evento_id ? { evento_id: e.evento_id, nombre: e.nombre, fecha: String(e.fecha).slice(0, 10), hora: e.hora, lugar: e.lugar } : null,
  // El nombre del asistente solo se muestra cuando la inscripción es de ese evento (EXITOSO o DUPLICADO).
  nombre_acreditacion: r.resultado === 'RECHAZADO' ? '' : r.inscripcion?.nombre_acreditacion || '', checkin_original: r.checkin_original || null };
const exitoso = r.resultado === 'EXITOSO';
return [{ json: { ...fila, exitoso,
  _status: r._status,
  _body: exitoso ? { ok: true, mensaje: r._mensaje, data } : { ok: false, error: { codigo: r._codigo, mensaje: r._mensaje }, data },
  _notificacion: exitoso ? { usuario_id: r.usuario_id, tipo: 'CHECKIN_EXITOSO', titulo: 'Ingreso registrado: ' + e.nombre,
    mensaje: 'Registramos tu ingreso a ' + e.nombre + ' (' + e.lugar + ') el ' + ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + '. ¡Disfruta el evento!',
    evento_id: r.evento_id, inscripcion_id: r.inscripcion_id } : null } }];
`, [11, 2]);
  w.agregarFila('Registrar en EP11 Checkins', 'EP11', 'Checkins', [12, 2]);

  w.nodo('¿Check-in exitoso?', 'n8n-nodes-base.if', 2.2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'b6f3c1de-5a51-4c55-9f0e-0c1a7e2d9a11', leftValue: "={{ $('Generar checkin_id').first().json.exitoso }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  }, [13, 2]);
  // Solo se toca la fila de esta inscripción (clave inscripcion_id).
  w.code('Preparar cambio a ASISTIO', `
const c = $('Generar checkin_id').first().json;
return [{ json: { inscripcion_id: $('Validar existencia').first().json.inscripcion.inscripcion_id, estado: 'ASISTIO', fecha_actualizacion: c.fecha_checkin } }];
`, [14, 1]);
  w.actualizarFila('Actualizar inscripción', 'EP06', 'Inscripciones', 'inscripcion_id', [15, 1]);

  w.armarRespuesta('Armar respuesta', ['Generar checkin_id'], [16, 2]);
  w.responder('Responder', [17, 2]);

  w.code('Preparar notificación', `
const n = $('Armar respuesta').first().json._notificacion;
if (!n) return [];
return [{ json: { ...n, clave_idempotencia: n.tipo + '|' + n.inscripcion_id } }];
`, [18, 2]);
  w.notificar('Notificar (WF09)', [19, 2]);

  w.cadena('Webhook Check-in', 'Leer Inscripciones', 'Leer Eventos', 'Leer historial de check-in', 'Validar existencia', '¿Existen inscripción y evento?');
  w.unir('¿Existen inscripción y evento?', 'Validar correspondencia inscripción-evento', 0);
  w.unir('¿Existen inscripción y evento?', 'Generar checkin_id', 1);
  w.cadena('Validar correspondencia inscripción-evento', '¿Corresponde al evento?');
  w.unir('¿Corresponde al evento?', 'Validar duplicado', 0);
  w.unir('¿Corresponde al evento?', 'Generar checkin_id', 1);
  w.cadena('Validar duplicado', '¿Es el primer ingreso?');
  w.unir('¿Es el primer ingreso?', 'Validar estado CONFIRMADA', 0);
  w.unir('¿Es el primer ingreso?', 'Generar checkin_id', 1);
  w.cadena('Validar estado CONFIRMADA', 'Generar checkin_id', 'Registrar en EP11 Checkins', '¿Check-in exitoso?');
  w.unir('¿Check-in exitoso?', 'Preparar cambio a ASISTIO', 0);
  w.unir('¿Check-in exitoso?', 'Armar respuesta', 1);
  w.cadena('Preparar cambio a ASISTIO', 'Actualizar inscripción', 'Armar respuesta', 'Responder', 'Preparar notificación', 'Notificar (WF09)');
  return w.json();
}
