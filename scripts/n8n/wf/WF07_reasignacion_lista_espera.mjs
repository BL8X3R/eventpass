import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF07 — Reasignación automática de lista de espera', cfg);

  w.nodo('Cada 5 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, [0, 1]);
  w.leer('Leer Eventos', 'EP04', 'Eventos', [1, 1]);
  w.filtro('Eventos PUBLICADOS', 'estado', ['PUBLICADO'], [2, 1]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [3, 1]);
  w.filtro('Solo lista de espera', 'estado', ['LISTA_ESPERA'], [4, 1]);
  w.nodo('Ordenar por fecha_inscripcion ASC', 'n8n-nodes-base.sort', 1, {
    sortFieldsUi: { sortField: [{ fieldName: 'fecha_inscripcion', order: 'ascending' }] },
    options: {},
  }, [5, 1], { alwaysOutputData: true });
  w.agrupar('Agrupar lista de espera', 'espera', [6, 1]);

  w.code('Calcular cupos libres y elegir promovidos', `
// Cupos libres = capacidad - (CONFIRMADAS + ASISTIO). Se promueve en orden de llegada (fecha_inscripcion ASC).
const espera = ($json.espera || []).filter((i) => i && i.inscripcion_id);
const confirmadas = {};
for (const i of filas('Leer Inscripciones', 'inscripcion_id')) if (['CONFIRMADA', 'ASISTIO'].includes(i.estado)) confirmadas[i.evento_id] = (confirmadas[i.evento_id] || 0) + 1;
const salida = [];
for (const e of filas('Eventos PUBLICADOS', 'evento_id')) {
  if (fechaEvento(e) <= ahora) continue;
  const libres = Number(e.capacidad) - (confirmadas[e.evento_id] || 0);
  if (libres <= 0) continue;
  const cola = espera.filter((i) => i.evento_id === e.evento_id)
    .sort((a, b) => new Date(a.fecha_inscripcion) - new Date(b.fecha_inscripcion));
  cola.slice(0, libres).forEach((i, idx) => salida.push({ json: {
    inscripcion_id: i.inscripcion_id, estado: 'CONFIRMADA', orden_espera: '', fecha_actualizacion: ahora.toISOString(),
    _meta: { evento: e, usuario_id: i.usuario_id, orden_lista: idx + 1, estado_anterior: i.estado },
  } }));
}
return salida;
`, [7, 1]);
  w.actualizarFila('Promover inscripción', 'EP06', 'Inscripciones', 'inscripcion_id', [8, 1]);
  w.code('Preparar notificación de cupo', `
return $('Calcular cupos libres y elegir promovidos').all().map(({ json: p }) => ({ json: {
  usuario_id: p._meta.usuario_id, tipo: 'REASIGNACION_CUPO', evento_id: p._meta.evento.evento_id, inscripcion_id: p.inscripcion_id,
  titulo: 'Se liberó un cupo para ti: ' + p._meta.evento.nombre,
  mensaje: 'Buenas noticias: se liberó un cupo en ' + p._meta.evento.nombre + ' y pasó a ser tuyo. Tu inscripción ahora está CONFIRMADA. Te esperamos el ' + String(p._meta.evento.fecha).slice(0, 10) + ' a las ' + p._meta.evento.hora + ' en ' + p._meta.evento.lugar + '.',
  clave_idempotencia: 'REASIGNACION_CUPO|' + p.inscripcion_id,
} }));
`, [9, 1]);
  w.notificar('Notificar (WF09)', [10, 1]);
  w.code('Fila de reasignación', `
const promovidos = $('Calcular cupos libres y elegir promovidos').all();
const resultados = $input.all();
return promovidos.map(({ json: p }, idx) => {
  const r = resultados[idx]?.json || {};
  return { json: {
    reasignacion_id: genId('REA'), evento_id: p._meta.evento.evento_id, inscripcion_id: p.inscripcion_id, usuario_id: p._meta.usuario_id,
    fecha: ahora.toISOString(), orden_lista: String(p._meta.orden_lista), estado_anterior: p._meta.estado_anterior, estado_nuevo: 'CONFIRMADA',
    resultado_notificacion: r.resultado ? 'gmail:' + r.gmail_estado + ' / telegram:' + r.telegram_estado : 'SIN_RESPUESTA',
  } };
});
`, [11, 1]);
  w.agregarFila('Registrar reasignación', 'EP07', 'Reasignaciones', [12, 1]);

  w.cadena('Cada 5 minutos', 'Leer Eventos', 'Eventos PUBLICADOS', 'Leer Inscripciones', 'Solo lista de espera', 'Ordenar por fecha_inscripcion ASC', 'Agrupar lista de espera',
    'Calcular cupos libres y elegir promovidos', 'Promover inscripción', 'Preparar notificación de cupo', 'Notificar (WF09)', 'Fila de reasignación', 'Registrar reasignación');
  return w.json();
}
