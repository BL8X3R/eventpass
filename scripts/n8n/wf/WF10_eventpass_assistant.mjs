import { crearWorkflow } from '../lib.mjs';

const REGLAS = `Eres EventPass Assistant, el asistente de soporte de EventPass, una plataforma de eventos de tecnología y emprendimiento (meetups, hackatones, talleres, networking).

Respondes en español, en tono cercano y directo, con respuestas cortas (máximo 6 líneas salvo que pidan un listado).

Puedes informar sobre: eventos, categorías, fechas, lugares, cupos, lista de espera, estados de inscripción, vinculación con Telegram y cómo funciona EventPass.

Restricciones estrictas (eres un asistente SOLO INFORMATIVO):
- No puedes crear usuarios, iniciar sesión, inscribir, cancelar inscripciones, modificar eventos, cambiar cupos ni cambiar ningún estado. No tienes herramientas para hacerlo.
- Si te piden una de esas acciones, explica en qué parte de la web se hace (Crear cuenta, Ingresar, botón Inscribirme en el evento, Mi cuenta) y no digas que lo hiciste.
- No inventes eventos, fechas, lugares ni cupos: usa solo los datos del bloque CATÁLOGO. Si algo no aparece, dilo.
- Nunca pidas ni repitas contraseñas, tokens o códigos de vinculación.

Cómo funciona EventPass:
- Cualquiera puede ver el catálogo. Para inscribirse hay que crear cuenta, iniciar sesión y vincular Telegram desde Mi cuenta.
- Vincular Telegram: en Mi cuenta se pide un código de 6 caracteres que dura 10 minutos y se envía al bot como "/vincular CODIGO". Cada código sirve una sola vez.
- Si hay cupo la inscripción queda CONFIRMADA. Si el evento está lleno queda en LISTA_ESPERA.
- Cuando alguien cancela, el cupo se reasigna automáticamente a quien lleva más tiempo en lista de espera, y se le avisa por Gmail y Telegram.
- Estados de inscripción: CONFIRMADA, LISTA_ESPERA, CANCELADA. Estados de evento visibles: PUBLICADO (abierto), CERRADO (no recibe inscripciones), CANCELADO.
- 24 horas antes del evento se envía un recordatorio por Gmail y Telegram a quienes tienen cupo confirmado.
- Una persona solo puede tener una inscripción activa por evento.`;

export default function (cfg) {
  const w = crearWorkflow('WF10 — EventPass Assistant', cfg);

  w.nodo('Chat Trigger', '@n8n/n8n-nodes-langchain.chatTrigger', 1.1, {
    public: true,
    mode: 'webhook',
    options: { allowedOrigins: '*', responseMode: 'lastNode', loadPreviousSession: 'notSupported' },
  }, [0, 2], { webhookId: crypto.randomUUID() });

  w.code('Identificar conversación', `
const t = $('Chat Trigger').first().json;
const meta = t.metadata || {};
const conversation_id = String(t.sessionId || genId('CNV'));
const usuario_id = String(meta.usuario_id || '').slice(0, 40);
const visitor_id = String(meta.visitor_id || '').slice(0, 64) || ('anon-' + conversation_id.slice(0, 12));
const texto = String(t.chatInput || '').trim().slice(0, 2000);
return [{ json: { conversation_id, usuario_id, visitor_id, texto, cerrar: texto.toLowerCase() === '/cerrar' } }];
`, [1, 2]);

  // Acceso de solo lectura: el asistente solo lee eventos e inscripciones para responder sobre cupos.
  w.leer('Leer Eventos (solo lectura)', 'EP04', 'Eventos', [2, 2]);
  w.leer('Leer Inscripciones (solo lectura)', 'EP06', 'Inscripciones', [3, 2]);
  w.leer('Leer Conversaciones', 'EP10', 'Conversaciones', [4, 2]);

  w.code('Preparar contexto del catálogo', `
const id = $('Identificar conversación').first().json;
const confirmadas = {}, espera = {};
for (const i of filas('Leer Inscripciones (solo lectura)', 'inscripcion_id')) {
  if (i.estado === 'CONFIRMADA') confirmadas[i.evento_id] = (confirmadas[i.evento_id] || 0) + 1;
  if (i.estado === 'LISTA_ESPERA') espera[i.evento_id] = (espera[i.evento_id] || 0) + 1;
}
const lineas = filas('Leer Eventos (solo lectura)', 'evento_id').filter((e) => e.estado !== 'BORRADOR').map((e) => {
  const cupos = Math.max(Number(e.capacidad) - (confirmadas[e.evento_id] || 0), 0);
  const pasado = fechaEvento(e) <= ahora;
  return '- ' + e.nombre + ' | ' + e.categoria + ' | ' + String(e.fecha).slice(0, 10) + ' ' + e.hora + ' | ' + e.lugar + ' | estado ' + e.estado + (pasado ? ' (ya pasó)' : '') + ' | cupos libres ' + cupos + ' de ' + e.capacidad + ' | en lista de espera ' + (espera[e.evento_id] || 0) + ' | organiza ' + e.organizador;
});
const contexto = 'Fecha y hora actual (Bogotá): ' + ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + '\\n\\nCATÁLOGO:\\n' + (lineas.join('\\n') || '(no hay eventos publicados)');
const previa = filas('Leer Conversaciones', 'conversation_id').find((c) => c.conversation_id === id.conversation_id);
const conversacion = {
  conversation_id: id.conversation_id,
  usuario_id: id.usuario_id || (previa ? previa.usuario_id : ''),
  visitor_id: id.visitor_id,
  fecha_inicio: previa ? previa.fecha_inicio : ahora.toISOString(),
  fecha_ultima_interaccion: ahora.toISOString(),
  estado: id.cerrar ? 'CERRADA' : 'ABIERTA',
};
return [{ json: { ...conversacion, nueva: !previa, contexto } }];
`, [5, 2]);
  w.agregarOActualizarFila('Guardar conversación', 'EP10', 'Conversaciones', 'conversation_id', [6, 2]);
  w.code('Mensajes del usuario', `
const c = $('Preparar contexto del catálogo').first().json;
const id = $('Identificar conversación').first().json;
const base = { conversation_id: c.conversation_id, usuario_id: c.usuario_id, visitor_id: c.visitor_id };
const salida = [];
if (c.nueva) salida.push({ json: { message_id: genId('MSG'), ...base, rol: 'SYSTEM', mensaje: 'Conversación iniciada. Reglas: asistente informativo de solo lectura.', timestamp: ahora.toISOString() } });
salida.push({ json: { message_id: genId('MSG'), ...base, rol: 'USER', mensaje: id.texto, timestamp: new Date(ahora.getTime() + 1).toISOString() } });
return salida;
`, [7, 2]);
  w.agregarFila('Guardar mensaje USER', 'EP10', 'Mensajes', [8, 2]);
  w.code('¿Cerrar conversación?', `
// Sin texto no se llama a la IA (Gemini rechaza entradas vacías).
const id = $('Identificar conversación').first().json;
return [{ json: { cerrar: id.cerrar || !id.texto } }];
`, [9, 2]);
  w.siVerdadero('¿Cerrar?', 'cerrar', [10, 2]);

  w.nodo('EventPass Assistant (IA)', '@n8n/n8n-nodes-langchain.agent', 1.7, {
    promptType: 'define',
    text: "={{ $('Identificar conversación').first().json.texto }}",
    options: { systemMessage: "=" + REGLAS.replace(/\{/g, '{ ').replace(/\}/g, ' }') + "\n\n{{ $('Preparar contexto del catálogo').first().json.contexto }}" },
  }, [11, 3], { executeOnce: true, onError: 'continueRegularOutput' });
  w.nodo('Google Gemini', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, {
    modelName: cfg.geminiModelo || 'models/gemini-3.5-flash-lite',
    options: { temperature: 0.3, maxOutputTokens: 800 },
  }, [11, 5], { credentials: { googlePalmApi: cfg.credenciales?.gemini || { id: 'PENDIENTE', name: 'Gemini EventPass' } } });
  w.nodo('Memoria de la conversación', '@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3, {
    sessionIdType: 'customKey',
    sessionKey: "={{ $('Identificar conversación').first().json.conversation_id }}",
    contextWindowLength: 10,
  }, [12, 5]);

  w.code('Mensaje ASSISTANT', `
const c = $('Preparar contexto del catálogo').first().json;
const id = $('Identificar conversación').first().json;
// Si Gemini falla o está saturado, se responde un mensaje claro en vez de un error 500.
const texto = $('EventPass Assistant (IA)').isExecuted
  ? String($('EventPass Assistant (IA)').first().json.output || 'El asistente no pudo responder en este momento. Intenta de nuevo en unos segundos.')
  : !id.texto ? 'Escribe tu pregunta y te ayudo.' : 'Conversación cerrada. Si necesitas algo más, escribe de nuevo y abrimos una nueva.';
return [{ json: { message_id: genId('MSG'), conversation_id: c.conversation_id, usuario_id: c.usuario_id, visitor_id: c.visitor_id, rol: 'ASSISTANT', mensaje: texto, timestamp: new Date().toISOString() } }];
`, [13, 2]);
  w.agregarFila('Guardar mensaje ASSISTANT', 'EP10', 'Mensajes', [14, 2]);
  w.code('Respuesta al chat', `
const m = $('Mensaje ASSISTANT').first().json;
return [{ json: { output: m.mensaje, conversation_id: m.conversation_id } }];
`, [15, 2]);

  w.cadena('Chat Trigger', 'Identificar conversación', 'Leer Eventos (solo lectura)', 'Leer Inscripciones (solo lectura)', 'Leer Conversaciones', 'Preparar contexto del catálogo',
    'Guardar conversación', 'Mensajes del usuario', 'Guardar mensaje USER', '¿Cerrar conversación?', '¿Cerrar?');
  w.unir('¿Cerrar?', 'Mensaje ASSISTANT', 0);
  w.unir('¿Cerrar?', 'EventPass Assistant (IA)', 1);
  w.unir('Google Gemini', 'EventPass Assistant (IA)', 0, 'ai_languageModel');
  w.unir('Memoria de la conversación', 'EventPass Assistant (IA)', 0, 'ai_memory');
  w.cadena('EventPass Assistant (IA)', 'Mensaje ASSISTANT', 'Guardar mensaje ASSISTANT', 'Respuesta al chat');
  return w.json();
}
