import { api, sesion, config, ErrorApi } from './api.js';
import { iniciarChat } from './chat.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

// ---------- utilidades ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const catVar = (cat) => `var(--cat-${slug(cat)}, var(--cobalto))`;
const TZ = 'America/Bogota';
const fechaLarga = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dia = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric' });
const mes = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, month: 'short' }).replace('.', '');
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const imagen = (url) => (!url ? '' : /^https?:\/\//.test(url) ? url : url.replace(/^\//, ''));

let toastTimer;
function toast(mensaje, tipo = 'exito') {
  const t = document.getElementById('toast');
  t.textContent = mensaje;
  t.className = 'toast' + (tipo === 'error' ? ' toast-error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function aviso(tipo, titulo, texto, extra = '') {
  return `<div class="aviso aviso-${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${extra}</div>`;
}

function avisoError(e, reintentar = true) {
  const sesionCaida = e instanceof ErrorApi && /^SESION_|USUARIO_INACTIVO/.test(e.codigo || '');
  if (sesionCaida) { sesion.borrar(); pintarNav(); }
  return aviso('error', sesionCaida ? 'Tu sesión terminó' : 'No se pudo cargar', e.message,
    sesionCaida ? `<a class="boton" href="#/ingresar?volver=${encodeURIComponent(location.hash.slice(1))}">Ingresar de nuevo</a>`
      : reintentar ? '<button class="boton boton-sec" type="button" data-reintentar>Intentar de nuevo</button>' : '');
}

// Envía un formulario mostrando el estado de carga en su botón.
async function enviar(form, tarea) {
  const boton = form.querySelector('[type=submit]');
  const zona = form.querySelector('[data-mensaje]');
  boton?.setAttribute('aria-busy', 'true');
  if (boton) boton.disabled = true;
  if (zona) zona.innerHTML = '';
  try {
    return await tarea(Object.fromEntries(new FormData(form)));
  } catch (e) {
    if (zona) zona.innerHTML = avisoError(e, false);
    else toast(e.message, 'error');
    return null;
  } finally {
    boton?.removeAttribute('aria-busy');
    if (boton) boton.disabled = false;
  }
}

function cupos(ev, grande = false) {
  const cap = Number(ev.capacidad) || 0;
  const max = grande ? 120 : 40;
  const celdas = cap <= max ? cap : (grande ? 60 : 20);
  const porCelda = cap / Math.max(celdas, 1);
  const llenas = Math.min(celdas, Math.round(ev.inscritos / porCelda));
  const fila = Array.from({ length: celdas }, (_, i) => `<i class="${i < llenas ? 'ocupado' : ''}"></i>`).join('');
  const nota = cap > max ? ` Cada casilla equivale a ${Math.round(porCelda)} cupos.` : '';
  const texto = ev.cupos_disponibles > 0
    ? `<b>${ev.cupos_disponibles}</b> de ${cap} cupos libres.`
    : `<b>Lleno.</b> ${ev.lista_espera ? ev.lista_espera + (ev.lista_espera === 1 ? ' persona' : ' personas') + ' en lista de espera.' : 'Puedes entrar a la lista de espera.'}`;
  return `<div class="cupos${grande ? ' grande' : ''}" style="--cat:${catVar(ev.categoria)}">
    <div class="cupos-fila" role="img" aria-label="${ev.inscritos} de ${cap} cupos ocupados">${fila}</div>
    <span class="cupos-texto">${texto}${nota}</span></div>`;
}

function estadoEvento(ev) {
  if (ev.estado === 'CANCELADO') return '<span class="estado estado-cancelado">Cancelado</span>';
  if (!ev.inscripcion_abierta) return '<span class="estado estado-cerrado">Inscripciones cerradas</span>';
  if (ev.lleno) return '<span class="estado estado-lleno">Lleno, con lista de espera</span>';
  if (ev.proximo) return '<span class="estado estado-pronto">Empieza en menos de 48 horas</span>';
  return '<span class="estado estado-abierto">Inscripciones abiertas</span>';
}

function recordarTelegram() {
  const s = sesion.actual();
  if (s) { s.telegram_vinculado = true; sesion.guardar(s); }
}

const NOMBRE_ESTADO = { CONFIRMADA: 'Cupo confirmado', LISTA_ESPERA: 'En lista de espera', CANCELADA: 'Cancelada', ASISTIO: 'Asististe' };

// ---------- navegación ----------
function pintarNav() {
  const s = sesion.actual();
  const ruta = location.hash.split('?')[0] || '#/';
  const enlace = (href, texto, extra = '') => `<a href="${href}" ${ruta === href || (href !== '#/' && ruta.startsWith(href)) ? 'aria-current="page"' : ''} ${extra}>${texto}</a>`;
  nav.innerHTML = s
    ? enlace('#/', 'Eventos') + enlace('#/checkin', 'Check-in') + enlace('#/cuenta', 'Mi cuenta') + '<a href="#/salir">Salir</a>'
    : enlace('#/', 'Eventos') + enlace('#/checkin', 'Check-in') + enlace('#/ingresar', 'Ingresar') + '<a class="boton" href="#/registro">Crear cuenta</a>';
}

// ---------- vista: catálogo ----------
let catalogoCache = null;

async function vistaCatalogo(params) {
  const categoria = params.get('categoria') || '';
  app.innerHTML = `
    <section class="portada"><div class="contenedor">
      <div>
        <h1>Meetups, hackatones y talleres de la comunidad tech</h1>
        <p class="bajada">Mira cuántos cupos quedan, inscríbete en un minuto y recibe la confirmación por Gmail y Telegram. Si el evento se llena, entras a la lista de espera y te avisamos cuando se libere un cupo.</p>
        <div id="filtros" aria-label="Filtrar por categoría"></div>
      </div>
      <div id="pase-destacado"></div>
    </div></section>
    <section class="seccion"><div class="contenedor">
      <div class="seccion-cabeza"><h2 id="titulo-lista">${categoria ? esc(categoria) : 'Próximos eventos'}</h2><p id="conteo"></p></div>
      <div id="lista"><ul class="tickets">${'<li class="ticket-esqueleto" aria-hidden="true"><span class="esqueleto" style="width:40%"></span><span class="esqueleto" style="width:85%;height:22px"></span><span class="esqueleto" style="width:65%"></span><span class="esqueleto" style="width:55%"></span></li>'.repeat(4)}</ul><p class="oculto" role="status">Cargando eventos…</p></div>
    </div></section>`;

  try {
    if (!catalogoCache) catalogoCache = (await api.catalogo.listado()).data;
    pintarPase(catalogoCache.eventos);
    pintarFiltros(catalogoCache.categorias, categoria);
    const eventos = categoria ? (await api.catalogo.filtro(categoria)).data.eventos : catalogoCache.eventos;
    pintarLista(eventos, categoria);
  } catch (e) {
    document.getElementById('lista').innerHTML = avisoError(e);
    document.getElementById('pase-destacado').innerHTML = '';
  }
}

function pintarPase(eventos) {
  const ev = eventos.find((e) => e.inscripcion_abierta && !e.lleno) || eventos.find((e) => e.inscripcion_abierta);
  const cont = document.getElementById('pase-destacado');
  if (!ev) { cont.innerHTML = ''; return; }
  const titular = sesion.actual()?.usuario?.nombre;
  cont.innerHTML = `
    <div class="colgante entra" style="--cat:${catVar(ev.categoria)}">
      <div class="cordon" aria-hidden="true"></div><div class="pinza" aria-hidden="true"></div>
      <article class="pase" style="--cat:${catVar(ev.categoria)}" aria-label="Próximo evento con cupos">
        <div class="pase-ojal" aria-hidden="true"></div>
        <div class="pase-banda"><strong>${esc(ev.categoria)}</strong><span>${esc(dia(ev.inicio))} ${esc(mes(ev.inicio))}</span></div>
        <div class="pase-cuerpo">
          <h2>${esc(ev.nombre)}</h2>
          <dl class="pase-dato"><dt>Cuándo</dt><dd>${esc(fechaLarga(ev.inicio))}, ${esc(hora(ev.inicio))}</dd><dt>Dónde</dt><dd>${esc(ev.lugar)}</dd></dl>
          ${cupos(ev)}
          <div class="pase-titular"><small>Titular del pase</small><b class="${titular ? '' : 'vacio'}">${esc(titular || 'Tu nombre aquí')}</b></div>
          <a class="boton" href="#/evento/${encodeURIComponent(ev.evento_id)}">Ver evento</a>
        </div>
      </article>
    </div>`;
}

function pintarFiltros(categorias, activa) {
  const chip = (cat, texto) => `<li><button class="chip" type="button" data-categoria="${esc(cat)}" aria-pressed="${cat === activa}" style="--cat:${cat ? catVar(cat) : 'var(--tinta)'}">${esc(texto)}</button></li>`;
  document.getElementById('filtros').innerHTML = `<ul class="filtros">${chip('', 'Todas')}${categorias.map((c) => chip(c, c)).join('')}</ul>`;
}

function pintarLista(eventos, categoria) {
  document.getElementById('conteo').textContent = eventos.length ? `${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'}` : '';
  if (!eventos.length) {
    document.getElementById('lista').innerHTML = `<div class="vacio-bloque"><h3>No hay eventos ${categoria ? 'de ' + esc(categoria) : 'publicados'} por ahora</h3><p>Prueba otra categoría o vuelve pronto: los organizadores publican nuevos eventos cada semana.</p>${categoria ? '<a class="boton boton-sec" href="#/">Ver todas las categorías</a>' : ''}</div>`;
    return;
  }
  document.getElementById('lista').innerHTML = `<ul class="tickets">${eventos.map((ev) => `
    <li><a class="ticket${ev.inscripcion_abierta ? '' : ' apagado'}" style="--cat:${catVar(ev.categoria)}" href="#/evento/${encodeURIComponent(ev.evento_id)}">
      <div class="ticket-cuerpo">
        <div class="ticket-meta"><span class="cat">${esc(ev.categoria)}</span><span>${esc(ev.lugar)}</span></div>
        <h3>${esc(ev.nombre)}</h3>
        ${estadoEvento(ev)}
        ${ev.estado === 'CANCELADO' ? '' : cupos(ev)}
      </div>
      <div class="ticket-talon"><span class="ticket-dia">${esc(dia(ev.inicio))}</span><span class="ticket-mes">${esc(mes(ev.inicio))}</span><span class="ticket-hora">${esc(hora(ev.inicio))}</span></div>
    </a></li>`).join('')}</ul>`;
}

// ---------- vista: detalle ----------
async function vistaDetalle(id) {
  app.innerHTML = `<section class="detalle"><div class="contenedor"><a class="detalle-volver" href="#/">Volver a eventos</a>
    <div class="ticket-esqueleto" aria-hidden="true" style="min-height:320px"><span class="esqueleto" style="width:30%"></span><span class="esqueleto" style="width:70%;height:34px"></span><span class="esqueleto" style="width:50%"></span></div>
    <p class="oculto" role="status">Cargando evento…</p></div></section>`;
  try {
    const logueado = !!sesion.token();
    // Una vez vinculado, Telegram no se desvincula desde la web: no hace falta volver a consultarlo.
    const yaVinculado = sesion.actual()?.telegram_vinculado === true;
    const [det, mias, tg] = await Promise.all([
      api.catalogo.detalle(id),
      logueado ? api.inscripciones.mias().catch((e) => e) : null,
      logueado && !yaVinculado ? api.telegram.estado().catch((e) => e) : null,
    ]);
    const ev = det.data.evento;
    if (mias instanceof ErrorApi && /^SESION_|USUARIO_INACTIVO/.test(mias.codigo)) { sesion.borrar(); pintarNav(); }
    const miInscripcion = mias && !(mias instanceof Error)
      ? mias.data.inscripciones.find((i) => i.evento_id === ev.evento_id && i.estado !== 'CANCELADA') : null;
    const telegramOk = yaVinculado || (tg && !(tg instanceof Error) ? tg.data.vinculado : false);
    if (telegramOk && !yaVinculado) recordarTelegram();
    const img = imagen(ev.imagen_url);

    app.innerHTML = `<section class="detalle"><div class="contenedor">
      <a class="detalle-volver" href="#/">Volver a eventos</a>
      <div class="detalle-rejilla">
        <article style="--cat:${catVar(ev.categoria)}">
          <div class="portada-evento">${img ? `<img src="${esc(img)}" alt="" onerror="this.remove()">` : ''}</div>
          ${estadoEvento(ev)}
          <h1>${esc(ev.nombre)}</h1>
          <dl class="datos">
            <dt>Categoría</dt><dd>${esc(ev.categoria)}</dd>
            <dt>Fecha</dt><dd>${esc(fechaLarga(ev.inicio))}</dd>
            <dt>Hora</dt><dd>${esc(hora(ev.inicio))}</dd>
            <dt>Lugar</dt><dd>${esc(ev.lugar)}</dd>
            <dt>Organiza</dt><dd>${esc(ev.organizador)}</dd>
          </dl>
          <p>${esc(ev.descripcion)}</p>
        </article>
        <aside class="panel panel-fijo" style="--cat:${catVar(ev.categoria)}" aria-label="Inscripción">
          <h2>${ev.estado === 'CANCELADO' ? 'Evento cancelado' : 'Cupos'}</h2>
          ${ev.estado === 'CANCELADO' ? '' : cupos(ev, true)}
          <div id="accion">${panelAccion(ev, miInscripcion, telegramOk)}</div>
        </aside>
      </div></div></section>`;
    conectarPanel(ev, miInscripcion);
  } catch (e) {
    app.querySelector('.contenedor').innerHTML = `<a class="detalle-volver" href="#/">Volver a eventos</a>${avisoError(e, e.status !== 404)}`;
  }
}

function panelAccion(ev, insc, telegramOk) {
  const volver = encodeURIComponent('/evento/' + ev.evento_id);
  if (insc?.estado === 'ASISTIO') return aviso('exito', NOMBRE_ESTADO.ASISTIO, `Tu ingreso a este evento ya quedó registrado. Gracias por venir, ${insc.nombre_acreditacion}.`);
  if (insc) {
    return `${aviso(insc.estado === 'CONFIRMADA' ? 'exito' : 'info', NOMBRE_ESTADO[insc.estado],
      insc.estado === 'CONFIRMADA' ? `Tu credencial saldrá a nombre de ${insc.nombre_acreditacion}.` : `Estás en la posición ${insc.orden_espera || '?'} de la lista de espera. Si se libera un cupo, lo asignamos en orden de llegada y te avisamos.`)}
      <button class="boton boton-peligro" type="button" data-cancelar="${esc(insc.inscripcion_id)}">${insc.estado === 'CONFIRMADA' ? 'Cancelar mi inscripción' : 'Salir de la lista de espera'}</button>`;
  }
  if (ev.estado === 'CANCELADO') return '<p>El organizador canceló este evento. Si estabas inscrito, te avisamos por Gmail y Telegram.</p>';
  if (!ev.inscripcion_abierta) return '<p>Este evento ya no recibe inscripciones.</p>';
  if (!sesion.token()) {
    return `<p>Para inscribirte necesitas una cuenta y tu Telegram vinculado; así te llegan la confirmación y los recordatorios.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="boton" href="#/ingresar?volver=${volver}">Ingresar</a><a class="boton boton-sec" href="#/registro?volver=${volver}">Crear cuenta</a></div>`;
  }
  if (!telegramOk) {
    return aviso('info', 'Falta vincular Telegram', 'Antes de inscribirte vincula tu Telegram. Toma un minuto y es la forma en que te avisamos de cupos y recordatorios.',
      `<a class="boton" href="#/cuenta/telegram?volver=${volver}">Vincular Telegram</a>`);
  }
  const nombre = sesion.actual()?.usuario?.nombre || '';
  return `<form id="form-inscripcion" novalidate>
    ${ev.lleno ? aviso('info', 'El evento está lleno', 'Si te inscribes, entras a la lista de espera. El primer cupo que se libere es para quien lleva más tiempo esperando.') : ''}
    <div class="campo"><label for="nombre_acreditacion">Nombre en la credencial</label><input id="nombre_acreditacion" name="nombre_acreditacion" value="${esc(nombre)}" maxlength="80" required></div>
    <div class="campo"><label for="observaciones">Observaciones (opcional)</label><textarea id="observaciones" name="observaciones" maxlength="300" placeholder="Equipo, necesidades de accesibilidad, alergias…"></textarea></div>
    <div data-mensaje></div>
    <button class="boton" type="submit" style="width:100%">${ev.lleno ? 'Unirme a la lista de espera' : 'Inscribirme'}</button>
  </form>`;
}

function conectarPanel(ev) {
  const form = document.getElementById('form-inscripcion');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, (d) => api.inscripciones.crear(ev.evento_id, d));
    if (r) { catalogoCache = null; toast(r.mensaje); vistaDetalle(ev.evento_id); }
  });
  app.querySelector('[data-cancelar]')?.addEventListener('click', async (e) => {
    if (!confirm('¿Seguro que quieres cancelar? Tu cupo pasará a la siguiente persona en lista de espera.')) return;
    const b = e.currentTarget;
    b.setAttribute('aria-busy', 'true'); b.disabled = true;
    try {
      const r = await api.inscripciones.cancelar(b.dataset.cancelar);
      catalogoCache = null; toast(r.mensaje); vistaDetalle(ev.evento_id);
    } catch (err) { toast(err.message, 'error'); b.removeAttribute('aria-busy'); b.disabled = false; }
  });
}

// ---------- vistas: ingresar / registro ----------
function vistaIngresar(params) {
  const volver = params.get('volver') || '/';
  app.innerHTML = `<section class="formulario-pagina"><div class="contenedor"><div class="panel">
    <h1>Ingresar</h1><p class="bajada">Usa el email y la contraseña de tu cuenta EventPass.</p>
    <form id="form-login" novalidate>
      <div class="campo"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="campo"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <div data-mensaje></div>
      <button class="boton" type="submit" style="width:100%">Ingresar</button>
    </form>
    <p style="margin-top:16px">¿No tienes cuenta? <a href="#/registro?volver=${encodeURIComponent(volver)}">Crea una</a>.</p>
  </div></div></section>`;
  const form = document.getElementById('form-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, (d) => api.auth.login(d.email, d.password));
    if (r) { sesion.guardar(r.data); catalogoCache = null; toast(`Hola, ${r.data.usuario.nombre}.`); location.hash = '#' + volver; }
  });
}

function vistaRegistro(params) {
  const volver = params.get('volver') || '/cuenta/telegram';
  app.innerHTML = `<section class="formulario-pagina"><div class="contenedor"><div class="panel">
    <h1>Crear cuenta</h1><p class="bajada">Con tu cuenta te inscribes a eventos y recibes avisos por Gmail y Telegram.</p>
    <form id="form-registro" novalidate>
      <div class="campo"><label for="nombre">Nombre</label><input id="nombre" name="nombre" autocomplete="name" maxlength="80" required></div>
      <div class="campo"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required><span class="ayuda">Aquí te llegan las confirmaciones.</span></div>
      <div class="campo"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="ayuda">Mínimo 8 caracteres, con letras y números.</span></div>
      <div data-mensaje></div>
      <button class="boton" type="submit" style="width:100%">Crear cuenta</button>
    </form>
    <p style="margin-top:16px">¿Ya tienes cuenta? <a href="#/ingresar">Ingresa</a>.</p>
  </div></div></section>`;
  const form = document.getElementById('form-registro');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, async (d) => {
      await api.usuarios.crear(d);
      return api.auth.login(d.email, d.password);
    });
    if (r) { sesion.guardar(r.data); toast('Cuenta creada. Ahora vincula tu Telegram.'); location.hash = '#' + volver; }
  });
}

// ---------- vista: mi cuenta ----------
const PESTANAS = { inscripciones: 'Mis inscripciones', telegram: 'Telegram', perfil: 'Perfil' };

function vistaCuenta(pestana, params) {
  if (!sesion.token()) { location.hash = '#/ingresar?volver=' + encodeURIComponent('/cuenta/' + (pestana || '')); return; }
  pestana = PESTANAS[pestana] ? pestana : 'inscripciones';
  const u = sesion.actual().usuario;
  app.innerHTML = `<section class="cuenta"><div class="contenedor">
    <h1>${esc(u.nombre)}</h1><p style="color:var(--tinta-2);margin:0">${esc(u.email)}</p>
    <div class="pestanas" role="tablist">${Object.entries(PESTANAS).map(([k, t]) => `<button role="tab" type="button" aria-selected="${k === pestana}" data-pestana="${k}">${t}</button>`).join('')}</div>
    <div id="contenido-cuenta" role="tabpanel"><p role="status">Cargando…</p></div>
  </div></section>`;
  app.querySelectorAll('[data-pestana]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/cuenta/' + b.dataset.pestana; }));
  ({ inscripciones: tabInscripciones, telegram: tabTelegram, perfil: tabPerfil })[pestana](document.getElementById('contenido-cuenta'), params);
}

async function tabInscripciones(cont) {
  try {
    const lista = (await api.inscripciones.mias()).data.inscripciones;
    if (!lista.length) {
      cont.innerHTML = '<div class="vacio-bloque"><h3>Aún no tienes inscripciones</h3><p>Elige un evento del catálogo y aparta tu cupo.</p><a class="boton" href="#/">Ver eventos</a></div>';
      return;
    }
    cont.innerHTML = `<ul class="lista-inscripciones">${lista.map((i) => `
      <li class="inscripcion" style="--cat:${catVar(i.evento.categoria)}">
        <div class="inscripcion-cabeza">
          <div><h3><a href="#/evento/${encodeURIComponent(i.evento_id)}">${esc(i.evento.nombre || i.evento_id)}</a></h3>
          <span style="color:var(--tinta-2);font-size:.95rem">${esc(i.evento.fecha)} a las ${esc(i.evento.hora)}, ${esc(i.evento.lugar)}</span></div>
          <span class="estado estado-${i.estado.toLowerCase()}">${NOMBRE_ESTADO[i.estado]}${i.estado === 'LISTA_ESPERA' && i.orden_espera ? ' (posición ' + esc(i.orden_espera) + ')' : ''}</span>
        </div>
        ${i.estado === 'CONFIRMADA' ? `<p class="codigo-checkin">Para tu ingreso muestra en la entrada: <code>${esc(i.inscripcion_id)}</code> · <code>${esc(i.evento_id)}</code></p>` : ''}
        ${['CANCELADA', 'ASISTIO'].includes(i.estado) ? '' : `
        <details><summary>Editar datos de la credencial</summary>
          <form data-editar="${esc(i.inscripcion_id)}" novalidate>
            <div class="campo"><label for="na-${esc(i.inscripcion_id)}">Nombre en la credencial</label><input id="na-${esc(i.inscripcion_id)}" name="nombre_acreditacion" value="${esc(i.nombre_acreditacion)}" maxlength="80" required></div>
            <div class="campo"><label for="ob-${esc(i.inscripcion_id)}">Observaciones</label><textarea id="ob-${esc(i.inscripcion_id)}" name="observaciones" maxlength="300">${esc(i.observaciones)}</textarea></div>
            <div data-mensaje></div>
            <div class="acciones"><button class="boton" type="submit">Guardar cambios</button>
            <button class="boton boton-peligro" type="button" data-cancelar="${esc(i.inscripcion_id)}">${i.estado === 'CONFIRMADA' ? 'Cancelar inscripción' : 'Salir de la lista de espera'}</button></div>
          </form>
        </details>`}
      </li>`).join('')}</ul>`;
    cont.querySelectorAll('[data-editar]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await enviar(f, (d) => api.inscripciones.actualizar(f.dataset.editar, d));
      if (r) { toast(r.mensaje); tabInscripciones(cont); }
    }));
    cont.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Seguro que quieres cancelar esta inscripción?')) return;
      b.setAttribute('aria-busy', 'true'); b.disabled = true;
      try { const r = await api.inscripciones.cancelar(b.dataset.cancelar); catalogoCache = null; toast(r.mensaje); tabInscripciones(cont); }
      catch (err) { toast(err.message, 'error'); b.removeAttribute('aria-busy'); b.disabled = false; }
    }));
  } catch (e) { cont.innerHTML = avisoError(e); }
}

async function tabTelegram(cont, params) {
  const volver = params?.get('volver');
  try {
    const est = (await api.telegram.estado()).data;
    if (est.vinculado) {
      recordarTelegram();
      cont.innerHTML = aviso('exito', 'Telegram vinculado', `Recibes los avisos en ${est.telegram_username || 'tu Telegram'} desde el ${new Date(est.fecha_vinculacion).toLocaleDateString('es-CO', { timeZone: TZ })}.`,
        volver ? `<a class="boton" href="#${esc(volver)}">Volver al evento</a>` : '');
      return;
    }
    const bot = config.botTelegram;
    cont.innerHTML = `<div class="dos-columnas"><div>
      <h2 style="margin-bottom:12px">Vincula tu Telegram</h2>
      <ol class="pasos">
        <li>Abre el bot ${bot ? `<a href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">@${esc(bot)}</a>` : 'de EventPass'} en Telegram.</li>
        <li>Genera un código aquí. Dura 10 minutos y sirve una sola vez.</li>
        <li>Envíale al bot el comando que aparece con tu código.</li>
      </ol>
      <button class="boton" type="button" id="generar">Generar código</button>
    </div><div id="zona-codigo"></div></div>`;
    document.getElementById('generar').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.setAttribute('aria-busy', 'true'); b.disabled = true;
      try {
        const r = (await api.telegram.solicitarCodigo()).data;
        document.getElementById('zona-codigo').innerHTML = `<div class="panel">
          <p style="margin:0">Envía esto al bot:</p>
          <div class="codigo-telegram">${esc(r.codigo)}</div>
          <p><code>${esc(r.comando)}</code></p>
          <p style="color:var(--tinta-2)">Vence a las ${esc(hora(r.expira_en))}.</p>
          ${bot ? `<a class="boton boton-sec" href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">Abrir Telegram</a> ` : ''}
          <button class="boton" type="button" id="comprobar">Ya lo envié</button></div>`;
        b.textContent = 'Generar otro código';
        document.getElementById('comprobar').addEventListener('click', () => tabTelegram(cont, params));
      } catch (err) { toast(err.message, 'error'); }
      b.removeAttribute('aria-busy'); b.disabled = false;
    });
  } catch (e) { cont.innerHTML = avisoError(e); }
}

async function tabPerfil(cont) {
  try {
    const p = (await api.usuarios.perfil()).data;
    cont.innerHTML = `<div class="dos-columnas">
      <form class="panel" id="form-nombre" novalidate><h2>Datos</h2>
        <div class="campo"><label for="p-nombre">Nombre</label><input id="p-nombre" name="nombre" value="${esc(p.nombre)}" maxlength="80" required></div>
        <div class="campo"><label for="p-email">Email</label><input id="p-email" value="${esc(p.email)}" disabled><span class="ayuda">El email identifica tu cuenta y no se puede cambiar.</span></div>
        <div data-mensaje></div><button class="boton" type="submit">Guardar nombre</button></form>
      <form class="panel" id="form-clave" novalidate><h2>Contraseña</h2>
        <div class="campo"><label for="p-actual">Contraseña actual</label><input id="p-actual" name="password_actual" type="password" autocomplete="current-password" required></div>
        <div class="campo"><label for="p-nueva">Nueva contraseña</label><input id="p-nueva" name="password_nueva" type="password" autocomplete="new-password" minlength="8" required><span class="ayuda">Mínimo 8 caracteres, con letras y números.</span></div>
        <div data-mensaje></div><button class="boton" type="submit">Cambiar contraseña</button></form>
      <form class="panel" id="form-baja" novalidate style="border-color:var(--error)"><h2>Desactivar cuenta</h2>
        <p>Tu cuenta queda INACTIVA: no podrás ingresar, pero tus datos e historial se conservan.</p>
        <div class="campo"><label for="p-baja">Escribe tu contraseña para confirmar</label><input id="p-baja" name="password" type="password" autocomplete="current-password" required></div>
        <div data-mensaje></div><button class="boton boton-peligro" type="submit">Desactivar mi cuenta</button></form>
    </div>`;
    const fNombre = document.getElementById('form-nombre');
    fNombre.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await enviar(fNombre, (d) => api.usuarios.actualizar({ nombre: d.nombre }));
      if (r) { const s = sesion.actual(); s.usuario.nombre = r.data.nombre; sesion.guardar(s); toast(r.mensaje); vistaCuenta('perfil'); }
    });
    const fClave = document.getElementById('form-clave');
    fClave.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await enviar(fClave, (d) => api.usuarios.actualizar(d));
      if (r) { fClave.reset(); toast('Contraseña actualizada.'); }
    });
    const fBaja = document.getElementById('form-baja');
    fBaja.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('¿Desactivar tu cuenta? No podrás volver a ingresar con ella.')) return;
      const r = await enviar(fBaja, (d) => api.usuarios.desactivar(d.password));
      if (r) { sesion.borrar(); pintarNav(); toast(r.mensaje); location.hash = '#/'; }
    });
  } catch (e) { cont.innerHTML = avisoError(e); }
}

async function salir() {
  try { await api.auth.logout(); } catch { /* la sesión local se borra igual */ }
  sesion.borrar();
  catalogoCache = null;
  toast('Sesión cerrada.');
  location.hash = '#/';
}

// ---------- vista: check-in digital (examen) ----------
// Pantalla para la persona que recibe a los asistentes en la entrada del evento.
function vistaCheckin(params) {
  app.innerHTML = `<section class="formulario-pagina"><div class="contenedor"><div class="panel">
    <h1>Check-in del evento</h1>
    <p class="bajada">Registra el ingreso de un asistente con el código de su inscripción y el código del evento. Lo encuentra en Mi cuenta, en Mis inscripciones.</p>
    <form id="form-checkin" novalidate>
      <div class="campo"><label for="inscripcion_id">Código de la inscripción</label><input id="inscripcion_id" name="inscripcion_id" value="${esc(params.get('inscripcion') || '')}" placeholder="INS-…" autocomplete="off" required></div>
      <div class="campo"><label for="evento_id">Código del evento</label><input id="evento_id" name="evento_id" value="${esc(params.get('evento') || '')}" placeholder="EVT-001" autocomplete="off" required></div>
      <button class="boton" type="submit" style="width:100%">Registrar ingreso</button>
    </form>
    <div id="resultado-checkin" aria-live="polite"></div>
  </div></div></section>`;

  const form = document.getElementById('form-checkin');
  const zona = document.getElementById('resultado-checkin');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (!d.inscripcion_id.trim() || !d.evento_id.trim()) {
      zona.innerHTML = aviso('error', 'Faltan datos', 'Escribe el código de la inscripción y el código del evento.');
      return;
    }
    const boton = form.querySelector('[type=submit]');
    boton.setAttribute('aria-busy', 'true'); boton.disabled = true;
    zona.innerHTML = '<p role="status">Registrando ingreso…</p>';
    try {
      const r = await api.checkin.registrar(d.inscripcion_id.trim(), d.evento_id.trim());
      const c = r.data.checkin;
      zona.innerHTML = aviso('exito', 'Check-in realizado correctamente',
        `${r.data.nombre_acreditacion || 'El asistente'} ingresó a ${r.data.evento.nombre} a las ${hora(c.fecha_checkin)}. Le enviamos la confirmación por Gmail y Telegram.`,
        `<p class="codigo-checkin">Registro: <code>${esc(c.checkin_id)}</code></p>`);
      form.reset();
    } catch (err) {
      // n8n responde DUPLICADO con el código CHECKIN_DUPLICADO; cualquier otro error es un RECHAZADO.
      if (err.codigo === 'CHECKIN_DUPLICADO') zona.innerHTML = aviso('info', 'Ingreso ya registrado', err.message);
      else zona.innerHTML = aviso('error', err.status ? 'Check-in rechazado' : 'No se pudo registrar', err.message);
    } finally {
      boton.removeAttribute('aria-busy'); boton.disabled = false;
    }
  });
}

// ---------- enrutador ----------
async function enrutar() {
  const [ruta, query] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query || '');
  const partes = ruta.split('/').filter(Boolean);
  pintarNav();
  window.scrollTo(0, 0);
  if (partes[0] === 'evento' && partes[1]) await vistaDetalle(decodeURIComponent(partes[1]));
  else if (partes[0] === 'ingresar') vistaIngresar(params);
  else if (partes[0] === 'registro') vistaRegistro(params);
  else if (partes[0] === 'cuenta') vistaCuenta(partes[1], params);
  else if (partes[0] === 'checkin') vistaCheckin(params);
  else if (partes[0] === 'salir') await salir();
  else await vistaCatalogo(params);
}

app.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-categoria]');
  if (chip) { location.hash = chip.dataset.categoria ? '#/?categoria=' + encodeURIComponent(chip.dataset.categoria) : '#/'; return; }
  if (e.target.closest('[data-reintentar]')) { catalogoCache = null; enrutar(); }
});

window.addEventListener('hashchange', enrutar);

// Revalida la sesión guardada contra WF02 al abrir la página.
if (sesion.token()) {
  api.auth.validar().then((r) => { const s = sesion.actual(); if (s) { s.usuario = r.data.usuario; sesion.guardar(s); pintarNav(); } })
    .catch((e) => { if (e instanceof ErrorApi && e.status === 401) { sesion.borrar(); pintarNav(); toast('Tu sesión terminó. Ingresa de nuevo.', 'error'); } });
}
enrutar();
iniciarChat();
