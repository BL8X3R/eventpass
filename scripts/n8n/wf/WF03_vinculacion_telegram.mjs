import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF03 — Vinculación con Telegram', cfg);
  const telegram = { telegramApi: cfg.credenciales?.telegram || { id: 'PENDIENTE', name: 'Telegram EventPass' } };

  // ===== Parte A: la web solicita un código (Webhook) =====
  w.webhook('Webhook Telegram', 'eventpass/telegram', [0, 1]);
  w.leer('Leer Usuarios', 'EP01', 'Usuarios', [1, 1]);
  w.leer('Leer Sesiones', 'EP02', 'Sesiones', [2, 1]);
  w.leer('Leer Códigos', 'EP03', 'Codigos_Vinculacion', [3, 1]);
  w.leer('Leer Vinculaciones', 'EP03', 'Vinculaciones', [4, 1]);

  w.code('Validar solicitud', `
const b = $('Webhook Telegram').first().json.body || {};
const accion = String(b.accion || '').trim().toLowerCase();
if (!['solicitar_codigo', 'estado'].includes(accion)) return fallo(400, 'ACCION_INVALIDA', 'La acción debe ser solicitar_codigo o estado.');
const v = validarSesion(b.session_token, filas('Leer Sesiones', 'session_id'), filas('Leer Usuarios', 'usuario_id'));
if (!v.ok) return fallo(401, v.codigo, v.mensaje);
const vinculacion = filas('Leer Vinculaciones', 'vinculacion_id').find((x) => x.usuario_id === v.usuario.usuario_id && x.estado === 'ACTIVA') || null;
return [{ json: { ruta: accion, usuario_id: v.usuario.usuario_id, vinculacion } }];
`, [5, 1]);
  w.switchRuta('Según acción', ['solicitar_codigo', 'estado', 'error'], [6, 1]);

  w.code('Generar código temporal', `
const crypto = require('crypto');
const v = $('Validar solicitud').first().json;
if (v.vinculacion) return fallo(409, 'YA_VINCULADO', 'Tu cuenta ya tiene Telegram vinculado.');
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let codigo = '';
for (let i = 0; i < 6; i++) codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
const MINUTOS = 10;
const fila = { codigo_id: genId('COD'), usuario_id: v.usuario_id, codigo, creado_en: ahora.toISOString(), expira_en: new Date(ahora.getTime() + MINUTOS * 60000).toISOString(), estado: 'PENDIENTE', usado_en: '' };
return [{ json: { ...fila, generar: true, _status: 201, _body: { ok: true, mensaje: 'Código generado. Envíalo al bot antes de ' + MINUTOS + ' minutos.', data: { codigo, expira_en: fila.expira_en, comando: '/vincular ' + codigo } } } }];
`, [7, 0]);
  w.siVerdadero('¿Código generado?', 'generar', [8, 0]);
  w.agregarFila('Guardar código', 'EP03', 'Codigos_Vinculacion', [9, 0]);

  w.code('Consultar vinculación', `
const v = $('Validar solicitud').first().json;
const x = v.vinculacion;
return ok(200, x ? { vinculado: true, telegram_username: x.telegram_username, fecha_vinculacion: x.fecha_vinculacion } : { vinculado: false }, x ? 'Telegram vinculado.' : 'Telegram aún no está vinculado.');
`, [7, 2]);

  w.armarRespuesta('Armar respuesta', ['Generar código temporal', 'Consultar vinculación', 'Validar solicitud'], [10, 1]);
  w.responder('Responder', [11, 1]);
  w.code('Códigos pendientes anteriores', `
// Un usuario solo puede tener un código PENDIENTE: los anteriores pasan a CANCELADO.
if (!$('Guardar código').isExecuted) return [];
const nuevo = $('Generar código temporal').first().json;
return filas('Leer Códigos', 'codigo_id')
  .filter((c) => c.usuario_id === nuevo.usuario_id && c.estado === 'PENDIENTE' && c.codigo_id !== nuevo.codigo_id)
  .map((c) => ({ json: { codigo_id: c.codigo_id, estado: 'CANCELADO' } }));
`, [12, 1]);
  w.actualizarFila('Cancelar códigos anteriores', 'EP03', 'Codigos_Vinculacion', 'codigo_id', [13, 1]);

  w.cadena('Webhook Telegram', 'Leer Usuarios', 'Leer Sesiones', 'Leer Códigos', 'Leer Vinculaciones', 'Validar solicitud', 'Según acción');
  w.unir('Según acción', 'Generar código temporal', 0);
  w.unir('Según acción', 'Consultar vinculación', 1);
  w.unir('Según acción', 'Armar respuesta', 2);
  w.cadena('Generar código temporal', '¿Código generado?');
  w.unir('¿Código generado?', 'Guardar código', 0);
  w.unir('¿Código generado?', 'Armar respuesta', 1);
  w.cadena('Guardar código', 'Armar respuesta');
  w.cadena('Consultar vinculación', 'Armar respuesta', 'Responder', 'Códigos pendientes anteriores', 'Cancelar códigos anteriores');

  // ===== Parte B: el usuario escribe /vincular CODIGO al bot (Telegram Trigger) =====
  w.nodo('Telegram Trigger', 'n8n-nodes-base.telegramTrigger', 1.2, { updates: ['message'], additionalFields: {} }, [0, 5], { credentials: telegram, webhookId: crypto.randomUUID() });
  w.leer('Leer Códigos (bot)', 'EP03', 'Codigos_Vinculacion', [1, 5]);
  w.leer('Leer Vinculaciones (bot)', 'EP03', 'Vinculaciones', [2, 5]);

  w.code('Extraer y validar código', `
const m = $('Telegram Trigger').first().json.message || {};
const chat_id = String(m.chat?.id || '');
const username = m.from?.username ? '@' + m.from.username : (m.from?.first_name || '');
const texto = String(m.text || '').trim();
const salida = (respuesta, extra = {}) => [{ json: { ruta: 'responder', chat_id, respuesta, ...extra } }];

const match = texto.match(/^\\/vincular(?:@\\w+)?\\s+([A-Za-z0-9]{4,12})$/i);
if (!match) {
  return salida('Hola. Soy el bot de EventPass.\\n\\nPara recibir avisos de tus eventos aquí, abre Mi cuenta en la web, pide un código de vinculación y envíamelo así:\\n/vincular TUCODIGO');
}
const codigo = match[1].toUpperCase();
const c = filas('Leer Códigos (bot)', 'codigo_id').find((x) => String(x.codigo).toUpperCase() === codigo);
if (!c) return salida('Ese código no existe. Revisa que esté bien escrito o pide uno nuevo en Mi cuenta.');
if (c.estado === 'USADO') return salida('Ese código ya fue usado. Cada código sirve una sola vez; pide uno nuevo en Mi cuenta si lo necesitas.');
if (c.estado === 'CANCELADO') return salida('Ese código fue reemplazado por uno más reciente. Usa el último código que generaste.');
if (c.estado === 'EXPIRADO' || new Date(c.expira_en) <= ahora) {
  return [{ json: { ruta: 'cambiar_codigo', chat_id, vincular: false, respuesta: 'Ese código expiró. Pide uno nuevo en Mi cuenta; dura 10 minutos.', cambio: { codigo_id: c.codigo_id, estado: 'EXPIRADO' } } }];
}
const otra = filas('Leer Vinculaciones (bot)', 'vinculacion_id').find((x) => String(x.chat_id) === chat_id && x.estado === 'ACTIVA' && x.usuario_id !== c.usuario_id);
if (otra) return salida('Este chat de Telegram ya está vinculado a otra cuenta de EventPass.');
return [{ json: { ruta: 'cambiar_codigo', chat_id, vincular: true,
  respuesta: 'Listo. Tu cuenta de EventPass quedó vinculada. Desde ahora recibirás aquí las confirmaciones, cambios de cupo y recordatorios de tus eventos.',
  cambio: { codigo_id: c.codigo_id, estado: 'USADO', usado_en: ahora.toISOString() },
  vinculacion: { vinculacion_id: genId('VIN'), usuario_id: c.usuario_id, chat_id, telegram_username: username, fecha_vinculacion: ahora.toISOString(), estado: 'ACTIVA' } } }];
`, [3, 5]);
  w.switchRuta('Resultado de validación', ['cambiar_codigo', 'responder'], [4, 5]);
  w.code('Cambio de estado del código', `
return [{ json: $('Extraer y validar código').first().json.cambio }];
`, [5, 4]);
  w.actualizarFila('Actualizar estado del código', 'EP03', 'Codigos_Vinculacion', 'codigo_id', [6, 4]);
  w.code('¿Crear vinculación?', `
const r = $('Extraer y validar código').first().json;
return [{ json: { vincular: r.vincular === true } }];
`, [7, 4]);
  w.siVerdadero('¿Vincular?', 'vincular', [8, 4]);
  w.code('Fila de vinculación', `
return [{ json: $('Extraer y validar código').first().json.vinculacion }];
`, [9, 3]);
  w.agregarFila('Guardar vinculación', 'EP03', 'Vinculaciones', [10, 3]);
  w.nodo('Responder en Telegram', 'n8n-nodes-base.telegram', 1.2, {
    chatId: "={{ $('Extraer y validar código').first().json.chat_id }}",
    text: "={{ $('Extraer y validar código').first().json.respuesta }}",
    additionalFields: { appendAttribution: false },
  }, [11, 5], { credentials: telegram, executeOnce: true });

  w.cadena('Telegram Trigger', 'Leer Códigos (bot)', 'Leer Vinculaciones (bot)', 'Extraer y validar código', 'Resultado de validación');
  w.unir('Resultado de validación', 'Cambio de estado del código', 0);
  w.unir('Resultado de validación', 'Responder en Telegram', 1);
  w.cadena('Cambio de estado del código', 'Actualizar estado del código', '¿Crear vinculación?', '¿Vincular?');
  w.unir('¿Vincular?', 'Fila de vinculación', 0);
  w.unir('¿Vincular?', 'Responder en Telegram', 1);
  w.cadena('Fila de vinculación', 'Guardar vinculación', 'Responder en Telegram');
  return w.json();
}
