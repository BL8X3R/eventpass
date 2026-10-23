import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF05 — Catálogo público', cfg);

  w.webhook('Webhook Catálogo', 'eventpass/catalogo', [0, 1]);
  w.leer('Leer Eventos', 'EP04', 'Eventos', [1, 1]);
  // BORRADOR nunca es público. CERRADO y CANCELADO se muestran marcados, sin inscripción.
  w.filtro('Solo eventos publicables', 'estado', ['PUBLICADO', 'CERRADO', 'CANCELADO'], [2, 1]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [3, 1]);
  w.filtro('Inscripciones activas', 'estado', ['CONFIRMADA', 'LISTA_ESPERA'], [4, 1]);
  w.agrupar('Agrupar inscripciones', 'inscripciones', [5, 1]);

  w.code('Calcular cupos y armar respuesta', `
const b = $('Webhook Catálogo').first().json.body || {};
const accion = String(b.accion || 'listado').trim().toLowerCase();
const visitor_id = String(b.visitor_id || '').slice(0, 64);
const log = (tipo, extra) => ({ _log: { tipo, visitor_id, evento_id: '', categoria: '', ...extra } });
if (!['listado', 'detalle', 'filtro'].includes(accion)) return fallo(400, 'ACCION_INVALIDA', 'La acción debe ser listado, detalle o filtro.', log('LISTADO', { status_http: 400, resultado_count: 0 }));

const inscripciones = ($json.inscripciones || []).filter((i) => i && i.inscripcion_id);
const conteo = {};
for (const i of inscripciones) {
  conteo[i.evento_id] ??= { confirmadas: 0, espera: 0 };
  if (i.estado === 'CONFIRMADA') conteo[i.evento_id].confirmadas++;
  else conteo[i.evento_id].espera++;
}
const HORAS_PROXIMO = 48;
const eventos = filas('Solo eventos publicables', 'evento_id').map((e) => {
  const capacidad = Number(e.capacidad) || 0;
  const c = conteo[e.evento_id] || { confirmadas: 0, espera: 0 };
  const inicio = fechaEvento(e);
  const futuro = inicio > ahora;
  const cupos = Math.max(capacidad - c.confirmadas, 0);
  return {
    evento_id: e.evento_id, nombre: e.nombre, categoria: e.categoria, descripcion: e.descripcion,
    fecha: String(e.fecha).slice(0, 10), hora: e.hora, inicio: inicio.toISOString(), lugar: e.lugar, imagen_url: e.imagen_url, organizador: e.organizador, estado: e.estado,
    capacidad, inscritos: c.confirmadas, cupos_disponibles: cupos, lista_espera: c.espera,
    inscripcion_abierta: e.estado === 'PUBLICADO' && futuro,
    lleno: cupos === 0,
    proximo: futuro && (inicio - ahora) <= HORAS_PROXIMO * 3600 * 1000,
  };
}).sort((a, b) => (b.inscripcion_abierta - a.inscripcion_abierta) || (new Date(a.inicio) - new Date(b.inicio)));
const categorias = [...new Set(eventos.map((e) => e.categoria))].sort();

if (accion === 'detalle') {
  const id = String(b.evento_id || '').trim().toUpperCase();
  const e = eventos.find((x) => String(x.evento_id).toUpperCase() === id);
  if (!e) return fallo(404, 'EVENTO_NO_ENCONTRADO', 'Ese evento no existe o todavía no está publicado.', log('DETALLE', { evento_id: id, status_http: 404, resultado_count: 0 }));
  return ok(200, { evento: e }, 'Detalle del evento.', log('DETALLE', { evento_id: e.evento_id, status_http: 200, resultado_count: 1 }));
}
if (accion === 'filtro') {
  const cat = String(b.categoria || '').trim();
  const lista = eventos.filter((e) => e.categoria.toLowerCase() === cat.toLowerCase());
  return ok(200, { eventos: lista, categorias, categoria: cat }, lista.length + ' eventos en ' + cat + '.', log('FILTRO', { categoria: cat, status_http: 200, resultado_count: lista.length }));
}
return ok(200, { eventos, categorias }, eventos.length + ' eventos.', log('LISTADO', { status_http: 200, resultado_count: eventos.length }));
`, [6, 1]);
  w.responder('Responder', [7, 1]);
  w.code('Fila de consulta', `
const l = $('Calcular cupos y armar respuesta').first().json._log;
return [{ json: { consulta_id: genId('CON'), fecha: ahora.toISOString(), tipo: l.tipo, evento_id: l.evento_id, categoria: l.categoria, resultado_count: String(l.resultado_count), visitor_id: l.visitor_id, status_http: String(l.status_http) } }];
`, [8, 1]);
  w.agregarFila('Registrar consulta', 'EP05', 'Consultas_Catalogo', [9, 1]);

  w.cadena('Webhook Catálogo', 'Leer Eventos', 'Solo eventos publicables', 'Leer Inscripciones', 'Inscripciones activas', 'Agrupar inscripciones', 'Calcular cupos y armar respuesta', 'Responder', 'Fila de consulta', 'Registrar consulta');
  return w.json();
}
