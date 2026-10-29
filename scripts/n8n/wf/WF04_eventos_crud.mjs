import { crearWorkflow } from '../lib.mjs';

export const CATEGORIAS = ['Tecnología', 'Emprendimiento', 'Networking', 'Educación', 'Comunidad'];

export default function (cfg) {
  const w = crearWorkflow('WF04 — Administración CRUD de eventos', cfg);
  const opciones = (lista) => ({ values: lista.map((option) => ({ option })) });

  w.nodo('Formulario de administración', 'n8n-nodes-base.formTrigger', 2.2, {
    authentication: 'basicAuth',
    formTitle: 'EventPass · Administración de eventos',
    formDescription: 'Solo para el administrador. Para CREAR llena todos los datos. Para CONSULTAR, PUBLICAR, CERRAR o CANCELAR basta el ID del evento. Para ACTUALIZAR escribe el ID y solo los campos que quieras cambiar.',
    formFields: { values: [
      { fieldLabel: 'Acción', fieldType: 'dropdown', fieldOptions: opciones(['CREAR', 'CONSULTAR', 'ACTUALIZAR', 'PUBLICAR', 'CERRAR', 'CANCELAR']), requiredField: true },
      { fieldLabel: 'ID del evento', placeholder: 'EVT-...' },
      { fieldLabel: 'Nombre' },
      { fieldLabel: 'Categoría', fieldType: 'dropdown', fieldOptions: opciones(['(sin cambio)', ...CATEGORIAS]) },
      { fieldLabel: 'Descripción', fieldType: 'textarea' },
      { fieldLabel: 'Fecha', fieldType: 'date' },
      { fieldLabel: 'Hora', placeholder: '18:30' },
      { fieldLabel: 'Lugar' },
      { fieldLabel: 'Capacidad', fieldType: 'number' },
      { fieldLabel: 'URL de imagen', placeholder: 'https://... o /img/eventos/tecnologia.svg' },
      { fieldLabel: 'Organizador' },
      { fieldLabel: 'Estado inicial', fieldType: 'dropdown', fieldOptions: opciones(['BORRADOR', 'PUBLICADO']) },
    ] },
    responseMode: 'lastNode',
    options: { path: 'eventpass-admin-eventos', appendAttribution: false, buttonLabel: 'Ejecutar acción' },
  }, [0, 2], { webhookId: crypto.randomUUID(), credentials: { httpBasicAuth: cfg.credenciales?.basicAuth || { id: 'PENDIENTE', name: 'Admin EventPass' } } });

  w.leer('Leer Eventos', 'EP04', 'Eventos', [1, 2]);
  w.leer('Leer Inscripciones', 'EP06', 'Inscripciones', [2, 2]);

  w.code('Validar formulario', `
const f = $('Formulario de administración').first().json;
const txt = (k) => String(f[k] ?? '').trim();
const accion = txt('Acción');
const id = txt('ID del evento').toUpperCase();
const errores = [];
const datos = {};
const CATEGORIAS = ${JSON.stringify(CATEGORIAS)};

if (txt('Nombre')) datos.nombre = txt('Nombre');
if (txt('Categoría') && txt('Categoría') !== '(sin cambio)') datos.categoria = txt('Categoría');
if (txt('Descripción')) datos.descripcion = txt('Descripción');
if (txt('Fecha')) { const d = txt('Fecha').slice(0, 10); if (/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) datos.fecha = d; else errores.push('la fecha debe tener formato AAAA-MM-DD'); }
if (txt('Hora')) { const h = txt('Hora'); if (/^([01]\\d|2[0-3]):[0-5]\\d$/.test(h)) datos.hora = h; else errores.push('la hora debe tener formato HH:MM (24 h)'); }
if (txt('Lugar')) datos.lugar = txt('Lugar');
if (txt('Capacidad')) { const c = Number(txt('Capacidad')); if (Number.isInteger(c) && c > 0 && c <= 5000) datos.capacidad = String(c); else errores.push('la capacidad debe ser un entero entre 1 y 5000'); }
if (txt('URL de imagen')) { const u = txt('URL de imagen'); if (/^(https?:\\/\\/|\\/)/.test(u)) datos.imagen_url = u; else errores.push('la URL de imagen debe empezar por https:// o /'); }
if (txt('Organizador')) datos.organizador = txt('Organizador');
if (datos.categoria && !CATEGORIAS.includes(datos.categoria)) errores.push('categoría no permitida');

if (accion === 'CREAR') {
  for (const k of ['nombre', 'categoria', 'descripcion', 'fecha', 'hora', 'lugar', 'capacidad', 'organizador']) if (!datos[k]) errores.push('falta ' + k);
} else if (!id) errores.push('escribe el ID del evento');

const auditoria = { evento_id: id, accion, resultado: 'ERROR' };
if (errores.length) return fallo(400, 'FORMULARIO_INVALIDO', 'Revisa el formulario: ' + errores.join('; ') + '.', { _auditoria: { ...auditoria, detalle: errores.join('; ') } });

const eventos = filas('Leer Eventos', 'evento_id');
const evento = id ? eventos.find((e) => String(e.evento_id).toUpperCase() === id) : null;
if (accion !== 'CREAR' && !evento) return fallo(404, 'EVENTO_NO_ENCONTRADO', 'No existe un evento con ID ' + id + '.', { _auditoria: { ...auditoria, detalle: 'ID no encontrado' } });

const ruta = { CREAR: 'crear', CONSULTAR: 'consultar', ACTUALIZAR: 'actualizar', PUBLICAR: 'estado', CERRAR: 'estado', CANCELAR: 'estado' }[accion];
return [{ json: { ruta, accion, datos, estado_inicial: txt('Estado inicial') || 'BORRADOR', evento: evento ? sinFila(evento) : null } }];
`, [3, 2]);

  w.switchRuta('Según acción', ['crear', 'consultar', 'actualizar', 'estado', 'error'], [4, 2]);

  w.code('Generar evento_id', `
const v = $('Validar formulario').first().json;
const fecha = ahora.toISOString();
const evento_id = genId('EVT');
const fila = { evento_id, ...v.datos, imagen_url: v.datos.imagen_url || '', estado: v.estado_inicial, fecha_creacion: fecha, fecha_actualizacion: fecha };
return [{ json: { ...fila, _status: 201, _body: { ok: true, mensaje: 'Evento creado con ID ' + evento_id + ' en estado ' + fila.estado + '.', data: fila },
  _auditoria: { evento_id, accion: 'CREAR', resultado: 'OK', detalle: 'Estado inicial ' + fila.estado } } }];
`, [5, 0]);
  w.agregarFila('Crear evento', 'EP04', 'Eventos', [6, 0]);

  w.code('Buscar evento por ID', `
const e = $('Validar formulario').first().json.evento;
const confirmadas = filas('Leer Inscripciones', 'inscripcion_id').filter((i) => i.evento_id === e.evento_id && ['CONFIRMADA', 'ASISTIO'].includes(i.estado)).length;
return ok(200, { ...e, inscritos_confirmados: confirmadas }, 'Evento encontrado.', { _auditoria: { evento_id: e.evento_id, accion: 'CONSULTAR', resultado: 'OK', detalle: '' } });
`, [5, 1]);

  w.code('Preparar actualización', `
const v = $('Validar formulario').first().json;
const e = v.evento;
const audit = (resultado, detalle) => ({ _auditoria: { evento_id: e.evento_id, accion: 'ACTUALIZAR', resultado, detalle } });
if (['CANCELADO'].includes(e.estado)) return fallo(409, 'EVENTO_CANCELADO', 'Un evento cancelado no se puede editar.', { aplicar: false, ...audit('ERROR', 'Evento cancelado') });
const cambios = Object.fromEntries(Object.entries(v.datos).filter(([k, val]) => String(e[k] ?? '') !== String(val)));
if (!Object.keys(cambios).length) return fallo(400, 'SIN_CAMBIOS', 'No escribiste ningún dato distinto al actual.', { aplicar: false, ...audit('ERROR', 'Sin cambios') });
if (cambios.capacidad) {
  const confirmadas = filas('Leer Inscripciones', 'inscripcion_id').filter((i) => i.evento_id === e.evento_id && ['CONFIRMADA', 'ASISTIO'].includes(i.estado)).length;
  if (Number(cambios.capacidad) < confirmadas) return fallo(409, 'CAPACIDAD_INSUFICIENTE', 'Hay ' + confirmadas + ' inscripciones confirmadas; la capacidad no puede ser menor.', { aplicar: false, ...audit('ERROR', 'Capacidad menor a confirmadas') });
}
const fila = { evento_id: e.evento_id, ...cambios, fecha_actualizacion: ahora.toISOString() };
const relevante = ['fecha', 'hora', 'lugar'].some((k) => k in cambios);
return [{ json: { ...fila, aplicar: true, _status: 200, _body: { ok: true, mensaje: 'Evento ' + e.evento_id + ' actualizado: ' + Object.keys(cambios).join(', ') + '.', data: { ...e, ...fila } },
  ...audit('OK', 'Campos: ' + Object.keys(cambios).join(', ')),
  _notificacion: relevante ? { evento: { ...e, ...cambios }, tipo: 'EVENTO_ACTUALIZADO', titulo: 'Cambió la información de ' + e.nombre, mensaje: 'El evento ' + e.nombre + ' cambió de ' + Object.keys(cambios).filter((k) => ['fecha', 'hora', 'lugar'].includes(k)).join(', ') + '. Ahora es el ' + (cambios.fecha || e.fecha) + ' a las ' + (cambios.hora || e.hora) + ' en ' + (cambios.lugar || e.lugar) + '.' } : null } }];
`, [5, 2]);

  w.code('Validar cambio de estado', `
const v = $('Validar formulario').first().json;
const e = v.evento;
const destino = { PUBLICAR: 'PUBLICADO', CERRAR: 'CERRADO', CANCELAR: 'CANCELADO' }[v.accion];
const permitidas = { BORRADOR: ['PUBLICADO', 'CANCELADO'], PUBLICADO: ['CERRADO', 'CANCELADO'], CERRADO: ['PUBLICADO', 'CANCELADO'], CANCELADO: [] };
const audit = (resultado, detalle) => ({ _auditoria: { evento_id: e.evento_id, accion: v.accion, resultado, detalle } });
if (!(permitidas[e.estado] || []).includes(destino)) return fallo(409, 'TRANSICION_INVALIDA', 'No se puede pasar de ' + e.estado + ' a ' + destino + '.', { aplicar: false, ...audit('ERROR', e.estado + ' -> ' + destino + ' no permitido') });
const fila = { evento_id: e.evento_id, estado: destino, fecha_actualizacion: ahora.toISOString() };
return [{ json: { ...fila, aplicar: true, _status: 200, _body: { ok: true, mensaje: 'Evento ' + e.evento_id + ' pasó de ' + e.estado + ' a ' + destino + '.', data: { ...e, ...fila } },
  ...audit('OK', e.estado + ' -> ' + destino),
  _notificacion: destino === 'CANCELADO' ? { evento: e, tipo: 'EVENTO_CANCELADO', titulo: e.nombre + ' fue cancelado', mensaje: 'Lamentamos informarte que el evento ' + e.nombre + ' del ' + e.fecha + ' fue cancelado por el organizador. Tu inscripción ya no es necesaria.' } : null } }];
`, [5, 3]);

  w.siVerdadero('¿Aplicar cambios?', 'aplicar', [6, 2]);
  w.actualizarFila('Actualizar evento', 'EP04', 'Eventos', 'evento_id', [7, 2]);

  w.armarRespuesta('Armar respuesta', ['Generar evento_id', 'Preparar actualización', 'Validar cambio de estado', 'Buscar evento por ID', 'Validar formulario'], [8, 2]);
  w.code('Fila de auditoría', `
const a = $('Armar respuesta').first().json._auditoria || { evento_id: '', accion: 'DESCONOCIDA', resultado: 'ERROR', detalle: '' };
return [{ json: { auditoria_id: genId('AUD'), evento_id: a.evento_id || '', accion: a.accion, fecha: ahora.toISOString(), resultado: a.resultado, detalle: a.detalle || '' } }];
`, [9, 2]);
  w.agregarFila('Registrar auditoría', 'EP04', 'Auditoria_Eventos', [10, 2]);
  w.nodo('Mostrar resultado', 'n8n-nodes-base.form', 1, {
    operation: 'completion',
    completionTitle: "={{ $('Armar respuesta').first().json._body.ok ? 'Acción realizada' : 'No se pudo completar' }}",
    completionMessage: `={{ (() => { const b = $('Armar respuesta').first().json._body; if (!b.ok) return b.error.mensaje; const d = b.data || {}; return b.mensaje + (d.evento_id ? '\\n\\n' + ['ID: ' + d.evento_id, 'Nombre: ' + d.nombre, 'Categoría: ' + d.categoria, 'Fecha: ' + d.fecha + ' ' + d.hora, 'Lugar: ' + d.lugar, 'Capacidad: ' + d.capacidad, 'Estado: ' + d.estado].concat(d.inscritos_confirmados !== undefined ? ['Confirmadas: ' + d.inscritos_confirmados] : []).join('\\n') : ''); })() }}`,
    options: {},
  }, [11, 2], { executeOnce: true });

  // Avisar a inscritos cuando el evento se cancela o cambia fecha/hora/lugar.
  w.code('Inscritos a notificar', `
const n = $('Armar respuesta').first().json._notificacion;
if (!n || !$('Actualizar evento').isExecuted) return [];
return filas('Leer Inscripciones', 'inscripcion_id')
  .filter((i) => i.evento_id === n.evento.evento_id && ['CONFIRMADA', 'LISTA_ESPERA'].includes(i.estado))
  .map((i) => ({ json: { usuario_id: i.usuario_id, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje, evento_id: n.evento.evento_id, inscripcion_id: i.inscripcion_id, clave_idempotencia: n.tipo + '|' + i.inscripcion_id + '|' + ahora.toISOString().slice(0, 16) } }));
`, [9, 4]);
  w.notificar('Notificar inscritos (WF09)', [10, 4]);

  w.cadena('Formulario de administración', 'Leer Eventos', 'Leer Inscripciones', 'Validar formulario', 'Según acción');
  w.unir('Según acción', 'Generar evento_id', 0);
  w.unir('Según acción', 'Buscar evento por ID', 1);
  w.unir('Según acción', 'Preparar actualización', 2);
  w.unir('Según acción', 'Validar cambio de estado', 3);
  w.unir('Según acción', 'Armar respuesta', 4);
  w.cadena('Generar evento_id', 'Crear evento', 'Armar respuesta');
  w.cadena('Buscar evento por ID', 'Armar respuesta');
  w.cadena('Preparar actualización', '¿Aplicar cambios?');
  w.cadena('Validar cambio de estado', '¿Aplicar cambios?');
  w.unir('¿Aplicar cambios?', 'Actualizar evento', 0);
  w.unir('¿Aplicar cambios?', 'Armar respuesta', 1);
  w.cadena('Actualizar evento', 'Armar respuesta', 'Fila de auditoría', 'Registrar auditoría', 'Mostrar resultado');
  w.cadena('Armar respuesta', 'Inscritos a notificar', 'Notificar inscritos (WF09)');
  return w.json();
}
