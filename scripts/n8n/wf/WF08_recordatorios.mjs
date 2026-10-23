import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF08 — Recordatorios automáticos', cfg);

  w.nodo('Cada 30 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }, [0, 1]);
  w.leer('Leer Eventos', 'EP04', 'Eventos', [1, 1]);
  w.filtro('Eventos PUBLICADOS', 'estado', ['PUBLICADO'], [2, 1]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [3, 1]);
  w.filtro('Inscripciones CONFIRMADAS', 'estado', ['CONFIRMADA'], [4, 1]);
  w.leer('Leer Recordatorios', 'EP08', 'Recordatorios', [5, 1]);

  w.code('Detectar eventos próximos', `
// Un recordatorio RECORDATORIO_24H por inscripción confirmada cuando faltan 24 horas o menos.
const VENTANA_HORAS = 24;
const TIPO = 'RECORDATORIO_24H';
const enviados = new Set(filas('Leer Recordatorios', 'recordatorio_id').filter((r) => ['ENVIADO', 'OMITIDO'].includes(r.estado)).map((r) => r.clave_idempotencia));
const eventos = Object.fromEntries(filas('Eventos PUBLICADOS', 'evento_id').map((e) => [e.evento_id, e]));
const salida = [];
for (const i of filas('Inscripciones CONFIRMADAS', 'inscripcion_id')) {
  const e = eventos[i.evento_id];
  if (!e) continue;
  const inicio = fechaEvento(e);
  const faltanMs = inicio - ahora;
  if (faltanMs <= 0 || faltanMs > VENTANA_HORAS * 3600 * 1000) continue;
  const clave = i.usuario_id + '|' + e.evento_id + '|' + TIPO;
  salida.push({ json: { clave, duplicado: enviados.has(clave), tipo: TIPO, usuario_id: i.usuario_id, evento_id: e.evento_id, inscripcion_id: i.inscripcion_id,
    fecha_programada: new Date(inicio.getTime() - VENTANA_HORAS * 3600 * 1000).toISOString(), evento: { nombre: e.nombre, fecha: String(e.fecha).slice(0, 10), hora: e.hora, lugar: e.lugar } } });
}
return salida;
`, [6, 1]);
  w.nodo('Sin recordatorio previo', 'n8n-nodes-base.filter', 2.2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: crypto.randomUUID(), leftValue: '={{ $json.duplicado }}', rightValue: '', operator: { type: 'boolean', operation: 'false', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  }, [7, 1]);
  w.code('Preparar notificación', `
return $input.all().map(({ json: r }) => ({ json: {
  usuario_id: r.usuario_id, tipo: r.tipo, evento_id: r.evento_id, inscripcion_id: r.inscripcion_id,
  titulo: 'Mañana es ' + r.evento.nombre,
  mensaje: 'Te recordamos que ' + r.evento.nombre + ' es el ' + r.evento.fecha + ' a las ' + r.evento.hora + ' en ' + r.evento.lugar + '. Tu cupo está confirmado. Si ya no puedes asistir, cancela desde Mi cuenta para liberar el cupo.',
  clave_idempotencia: r.clave,
} }));
`, [8, 1]);
  w.notificar('Notificar (WF09)', [9, 1]);
  w.code('Fila de recordatorio', `
const pendientes = $('Sin recordatorio previo').all();
const resultados = $input.all();
return pendientes.map(({ json: r }, idx) => {
  const n = resultados[idx]?.json || {};
  const estado = n.resultado === 'OMITIDO' ? 'OMITIDO' : (n.gmail_estado === 'ENVIADO' || n.telegram_estado === 'ENVIADO') ? 'ENVIADO' : 'ERROR';
  return { json: { recordatorio_id: genId('REC'), usuario_id: r.usuario_id, evento_id: r.evento_id, inscripcion_id: r.inscripcion_id, tipo_recordatorio: r.tipo,
    fecha_programada: r.fecha_programada, fecha_envio: estado === 'ENVIADO' ? ahora.toISOString() : '', estado, clave_idempotencia: r.clave } };
});
`, [10, 1]);
  w.agregarFila('Registrar recordatorio', 'EP08', 'Recordatorios', [11, 1]);

  w.cadena('Cada 30 minutos', 'Leer Eventos', 'Eventos PUBLICADOS', 'Leer Inscripciones', 'Inscripciones CONFIRMADAS', 'Leer Recordatorios', 'Detectar eventos próximos',
    'Sin recordatorio previo', 'Preparar notificación', 'Notificar (WF09)', 'Fila de recordatorio', 'Registrar recordatorio');
  return w.json();
}
