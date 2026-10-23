import { crearWorkflow } from '../lib.mjs';

export default function (cfg) {
  const w = crearWorkflow('WF09 — Servicio central de notificaciones', cfg);

  w.nodo('Recibir notificación', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'passthrough' }, [0, 2]);
  w.code('Validar entrada', `
const n = $('Recibir notificación').first().json;
const faltan = ['usuario_id', 'tipo', 'titulo', 'mensaje'].filter((k) => !n[k]);
const clave = String(n.clave_idempotencia || [n.tipo, n.usuario_id, n.evento_id || '', n.inscripcion_id || ''].join('|'));
return [{ json: { valida: !faltan.length, faltan, usuario_id: String(n.usuario_id || ''), tipo: String(n.tipo || ''), titulo: String(n.titulo || ''), mensaje: String(n.mensaje || ''), evento_id: String(n.evento_id || ''), inscripcion_id: String(n.inscripcion_id || ''), clave_idempotencia: clave } }];
`, [1, 2]);
  w.leer('Consultar usuario', 'EP01', 'Usuarios', [2, 2]);
  w.leer('Consultar chat_id', 'EP03', 'Vinculaciones', [3, 2]);
  w.leer('Leer notificaciones previas', 'EP09', 'Notificaciones', [4, 2]);

  w.code('Preparar destinatarios', `
const n = $('Validar entrada').first().json;
const u = filas('Consultar usuario', 'usuario_id').find((x) => x.usuario_id === n.usuario_id);
const vin = filas('Consultar chat_id', 'vinculacion_id').find((x) => x.usuario_id === n.usuario_id && x.estado === 'ACTIVA');
const previa = filas('Leer notificaciones previas', 'notificacion_id').find((x) => x.clave_idempotencia === n.clave_idempotencia && (x.gmail_estado === 'ENVIADO' || x.telegram_estado === 'ENVIADO'));
const omitir = !n.valida || !u || !!previa;
const motivo = !n.valida ? 'Faltan campos: ' + n.faltan.join(', ') : !u ? 'Usuario no encontrado' : previa ? 'Ya enviada (' + previa.notificacion_id + ')' : '';
return [{ json: { ...n, omitir, motivo, email: u ? u.email_normalizado : '', nombre: u ? u.nombre : '', chat_id: vin ? String(vin.chat_id) : '' } }];
`, [5, 2]);
  w.siVerdadero('¿Omitir?', 'omitir', [6, 2]);

  // Gmail y Telegram corren en secuencia, pero cada uno continúa aunque el otro falle.
  w.nodo('Enviar Gmail', 'n8n-nodes-base.gmail', 2.1, {
    sendTo: '={{ $json.email }}',
    subject: '={{ $json.titulo }}',
    emailType: 'html',
    message: `={{ '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:2px solid #1E2230;border-radius:14px;overflow:hidden">'
 + '<div style="background:#3046C9;color:#fff;padding:16px 20px;font-size:20px;font-weight:bold">EventPass</div>'
 + '<div style="padding:20px;color:#1E2230;font-size:15px;line-height:1.5"><p>Hola ' + $json.nombre + ',</p><p>' + $json.mensaje + '</p>'
 + '<p style="color:#5B6170;font-size:13px">Recibes este correo porque tienes una cuenta en EventPass. Tipo de aviso: ' + $json.tipo + '.</p></div></div>' }}`,
    options: { appendAttribution: false },
  }, [7, 3], { credentials: { gmailOAuth2: cfg.credenciales?.gmail || { id: 'PENDIENTE', name: 'Gmail EventPass' } }, onError: 'continueRegularOutput' });
  w.code('Resultado Gmail', `
const r = $input.first().json;
const d = $('Preparar destinatarios').first().json;
const enviado = !r.error && !!(r.id || r.threadId || r.labelIds);
return [{ json: { ...d, tiene_telegram: !!d.chat_id, gmail_estado: !d.email ? 'NO_APLICA' : enviado ? 'ENVIADO' : 'ERROR', gmail_error: enviado || !d.email ? '' : String(r.error?.message || r.error || 'Error desconocido').slice(0, 300) } }];
`, [8, 3]);
  w.siVerdadero('¿Tiene Telegram?', 'tiene_telegram', [9, 3]);
  w.nodo('Enviar Telegram', 'n8n-nodes-base.telegram', 1.2, {
    chatId: '={{ $json.chat_id }}',
    text: "={{ '🎟 ' + $json.titulo + '\\n\\n' + $json.mensaje }}",
    additionalFields: { appendAttribution: false },
  }, [10, 2], { credentials: { telegramApi: cfg.credenciales?.telegram || { id: 'PENDIENTE', name: 'Telegram EventPass' } }, onError: 'continueRegularOutput' });
  w.code('Resultado Telegram', `
const r = $input.first().json;
const d = $('Resultado Gmail').first().json;
const enviado = !r.error && !!(r.message_id || r.result?.message_id || r.ok);
return [{ json: { ...d, telegram_estado: enviado ? 'ENVIADO' : 'ERROR', telegram_error: enviado ? '' : String(r.error?.message || r.error || 'Error desconocido').slice(0, 300) } }];
`, [11, 2]);
  w.code('Telegram no aplica', `
return [{ json: { ...$('Resultado Gmail').first().json, telegram_estado: 'NO_APLICA', telegram_error: 'Usuario sin Telegram vinculado' } }];
`, [11, 4]);
  w.code('Fila de notificación', `
const d = $input.first().json;
return [{ json: { notificacion_id: genId('NOT'), usuario_id: d.usuario_id, tipo: d.tipo, titulo: d.titulo, mensaje: d.mensaje, evento_id: d.evento_id, inscripcion_id: d.inscripcion_id,
  fecha: ahora.toISOString(), gmail_estado: d.gmail_estado, telegram_estado: d.telegram_estado, gmail_error: d.gmail_error, telegram_error: d.telegram_error, clave_idempotencia: d.clave_idempotencia } }];
`, [12, 3]);
  w.agregarFila('Registrar resultado', 'EP09', 'Notificaciones', [13, 3]);
  w.code('Resultado de la notificación', `
if ($('Fila de notificación').isExecuted) {
  const f = $('Fila de notificación').first().json;
  return [{ json: { resultado: 'PROCESADA', notificacion_id: f.notificacion_id, gmail_estado: f.gmail_estado, telegram_estado: f.telegram_estado, clave_idempotencia: f.clave_idempotencia } }];
}
const d = $('Preparar destinatarios').first().json;
return [{ json: { resultado: 'OMITIDO', motivo: d.motivo, gmail_estado: 'NO_APLICA', telegram_estado: 'NO_APLICA', clave_idempotencia: d.clave_idempotencia } }];
`, [14, 2]);

  w.cadena('Recibir notificación', 'Validar entrada', 'Consultar usuario', 'Consultar chat_id', 'Leer notificaciones previas', 'Preparar destinatarios', '¿Omitir?');
  w.unir('¿Omitir?', 'Resultado de la notificación', 0);
  w.unir('¿Omitir?', 'Enviar Gmail', 1);
  w.cadena('Enviar Gmail', 'Resultado Gmail', '¿Tiene Telegram?');
  w.unir('¿Tiene Telegram?', 'Enviar Telegram', 0);
  w.unir('¿Tiene Telegram?', 'Telegram no aplica', 1);
  w.cadena('Enviar Telegram', 'Resultado Telegram', 'Fila de notificación');
  w.cadena('Telegram no aplica', 'Fila de notificación');
  w.cadena('Fila de notificación', 'Registrar resultado', 'Resultado de la notificación');
  return w.json();
}
