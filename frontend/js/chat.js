// Panel del asistente (WF10). Solo envía y muestra mensajes; las respuestas salen de n8n.
import { api } from './api.js';

const SUGERENCIAS = ['¿Qué eventos hay esta semana?', '¿Cómo funciona la lista de espera?', '¿Cómo vinculo Telegram?'];
const leer = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } };
const escribir = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
// Gemini responde con Markdown básico: se escapa todo y solo se interpretan **negritas** y *cursivas*.
const negritas = (t) => String(t)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
const nuevaConversacion =() => 'cnv-' + (crypto.randomUUID?.() || Date.now().toString(36));

export function iniciarChat() {
  const abrir = document.getElementById('chat-abrir');
  const panel = document.getElementById('chat-panel');
  const lista = document.getElementById('chat-mensajes');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-texto');
  let conversacion = leer('ep_chat_id', null) || nuevaConversacion();
  let mensajes = leer('ep_chat_msgs', []);
  let ocupado = false;

  const guardar = () => { escribir('ep_chat_id', conversacion); escribir('ep_chat_msgs', mensajes.slice(-40)); };

  function pintar() {
    lista.innerHTML = '';
    if (!mensajes.length) {
      const p = document.createElement('div');
      p.className = 'msg msg-assistant';
      p.textContent = 'Hola. Puedo contarte qué eventos hay, cuántos cupos quedan y cómo funcionan las inscripciones, la lista de espera y Telegram.';
      const s = document.createElement('div');
      s.className = 'chat-sugerencias';
      SUGERENCIAS.forEach((t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => enviarTexto(t); s.append(b); });
      lista.append(p, s);
    }
    for (const m of mensajes) {
      const d = document.createElement('div');
      d.className = 'msg msg-' + m.rol;
      if (m.rol === 'assistant') d.innerHTML = negritas(m.texto);
      else d.textContent = m.texto;
      lista.append(d);
    }
    lista.scrollTop = lista.scrollHeight;
  }

  async function enviarTexto(texto) {
    if (ocupado || !texto.trim()) return;
    ocupado = true;
    mensajes.push({ rol: 'user', texto });
    pintar();
    const esperando = document.createElement('div');
    esperando.className = 'msg msg-assistant msg-escribiendo';
    esperando.textContent = 'Escribiendo…';
    lista.append(esperando);
    lista.scrollTop = lista.scrollHeight;
    try {
      const respuesta = await api.chat(conversacion, texto);
      mensajes.push({ rol: 'assistant', texto: respuesta || 'No tengo una respuesta para eso.' });
    } catch (e) {
      mensajes.push({ rol: 'error', texto: e.message });
    }
    ocupado = false;
    guardar();
    pintar();
  }

  function alternar(mostrar) {
    panel.hidden = !mostrar;
    abrir.hidden = mostrar;
    abrir.setAttribute('aria-expanded', String(mostrar));
    if (mostrar) { pintar(); input.focus(); } else abrir.focus();
  }

  abrir.addEventListener('click', () => alternar(true));
  document.getElementById('chat-cerrar').addEventListener('click', () => alternar(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') alternar(false); });
  document.getElementById('chat-nueva').addEventListener('click', () => {
    if (mensajes.length) api.chat(conversacion, '/cerrar').catch(() => {});
    conversacion = nuevaConversacion();
    mensajes = [];
    guardar();
    pintar();
    input.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    enviarTexto(t);
  });
}
