# EventPass

**Estudiantes:** Fabian y Rueda
**Aplicación publicada (Vercel):** https://eventpass-zeta.vercel.app
**Repositorio:** https://github.com/BL8X3R/eventpass

EventPass es una aplicación web pública para descubrir e inscribirse en eventos de la comunidad tech y de emprendimiento (meetups, hackatones, talleres, networking). El frontend es un cliente estático publicado en Vercel; **toda la lógica de negocio vive en n8n**: validaciones, estados, cupos, lista de espera, idempotencia, persistencia en Google Sheets y notificaciones por Gmail y Telegram. Un asistente con IA (Google Gemini) responde dudas en modo solo lectura.

---

## Contenido

1. [Arquitectura general](#1-arquitectura-general)
2. [Tecnologías](#2-tecnologías)
3. [Workflows, triggers y Google Sheets](#3-workflows-triggers-y-google-sheets)
4. [Comunicación frontend → n8n](#4-comunicación-frontend--n8n)
5. [Endpoints](#5-endpoints)
6. [Estados](#6-estados)
7. [Hashing de contraseñas](#7-hashing-de-contraseñas)
8. [Manejo de sesiones](#8-manejo-de-sesiones)
9. [Idempotencia](#9-idempotencia)
10. [Lista de espera y reasignación](#10-lista-de-espera-y-reasignación)
11. [Servicio central de notificaciones](#11-servicio-central-de-notificaciones)
12. [Asistente IA y sus restricciones](#12-asistente-ia-y-sus-restricciones)
13. [Datos de prueba](#13-datos-de-prueba)
14. [Variables de entorno](#14-variables-de-entorno)
15. [Cómo ejecutar el proyecto](#15-cómo-ejecutar-el-proyecto)
16. [Estructura del repositorio](#16-estructura-del-repositorio)
17. [Examen — Check-in digital](#17-examen--check-in-digital)

---

## 1. Arquitectura general

```
 Navegador (Vercel: HTML/CSS/JS estático)
        │  fetch POST JSON            │  Chat (POST /chat)
        ▼                             ▼
 ┌──────────────────────── n8n (Docker + túnel HTTPS) ────────────────────────┐
 │  WF01 Usuarios   WF02 Auth   WF03 Telegram   WF05 Catálogo   WF06 Inscrip.  │
 │  WF04 Admin (Form)   WF07 Reasignación (cron)   WF08 Recordatorios (cron)   │
 │  WF10 Assistant (Chat Trigger + Gemini)   WF11 Check-in (examen)            │
 │                  │ Execute Sub-workflow                                     │
 │                  ▼                                                          │
 │           WF09 Notificaciones ──► Gmail  +  Telegram                        │
 └─────────────────────────────────┬──────────────────────────────────────────┘
                                   ▼
          Google Sheets (11 archivos independientes: EP01 … EP11)
```

Principios aplicados:

- **El frontend es solo cliente.** No conoce Google Sheets ni guarda reglas de negocio; envía solicitudes y muestra lo que n8n responde. La sesión en `localStorage` es una comodidad: n8n la revalida en cada operación.
- **Un archivo de Sheets por dominio.** Cada workflow escribe su información principal en su propio archivo; puede *leer* otros dominios cuando lo necesita (por ejemplo, WF06 lee sesiones, usuarios, vinculaciones y eventos).
- **Borrado lógico en todo.** Nada se elimina físicamente: usuarios, eventos e inscripciones cambian de estado.
- **Notificaciones centralizadas.** Ningún workflow envía Gmail o Telegram por su cuenta: todos llaman a WF09.
- **Respuestas uniformes.** Todos los webhooks responden `{ ok: true, mensaje, data }` o `{ ok: false, error: { codigo, mensaje } }` con el código HTTP adecuado (200, 201, 400, 401, 403, 404, 409, 412).

### Patrón interno de los workflows con webhook

Para que cada responsabilidad sea identificable, los workflows siguen la misma forma:

```
Webhook → Leer hojas necesarias → Code "Validar solicitud" → Switch por operación
   → Code de decisión de cada operación → IF → Google Sheets (append/update)
   → Code "Armar respuesta" → Respond to Webhook → (auditoría / notificación)
```

Cada Code de decisión produce la fila a guardar y, aparte, `_body` (respuesta HTTP), `_auditoria` y `_notificacion`. El nodo **Armar respuesta** toma la respuesta del nodo de decisión más específico que se ejecutó. La respuesta HTTP se envía **antes** de auditar y notificar, así una falla de Gmail o Telegram nunca deja al usuario esperando.

## 2. Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript sin frameworks (módulos ES). Tipografía Archivo (Google Fonts). |
| Publicación | Vercel (build: `node scripts/build.mjs` → `dist/`) |
| Orquestación y reglas | n8n 2.x en Docker (Webhook, Form Trigger, Schedule Trigger, Telegram Trigger, Chat Trigger, Execute Sub-workflow, Code, Switch, IF, Filter, Sort, Aggregate, Google Sheets, Gmail, Telegram, AI Agent) |
| Persistencia | Google Sheets (11 archivos) |
| Mensajería | Gmail (OAuth2) y Telegram Bot API |
| IA | Google Gemini (`gemini-3.5-flash-lite`) mediante el nodo AI Agent de n8n |
| Exposición pública de n8n | Túnel HTTPS de ngrok con dominio estático |
| Generación de workflows | `scripts/n8n/` (Node.js): genera, sube y exporta los workflows por la API de n8n |

## 3. Workflows, triggers y Google Sheets

| Workflow | Archivo JSON | Trigger | Google Sheets principal (hojas) |
|---|---|---|---|
| WF01 Usuarios CRUD | `n8n/WF01_usuarios_crud.json` | Webhook `POST /webhook/eventpass/usuarios` | **EP01_Usuarios** (`Usuarios`, `Auditoria_Usuarios`) |
| WF02 Autenticación y sesiones | `n8n/WF02_auth_sesiones.json` | Webhook `POST /webhook/eventpass/auth` | **EP02_Sesiones** (`Sesiones`) |
| WF03 Vinculación Telegram | `n8n/WF03_vinculacion_telegram.json` | Webhook `POST /webhook/eventpass/telegram` **y** Telegram Trigger | **EP03_Telegram** (`Codigos_Vinculacion`, `Vinculaciones`) |
| WF04 Administración de eventos | `n8n/WF04_eventos_crud.json` | n8n Form Trigger (con Basic Auth) | **EP04_Eventos** (`Eventos`, `Auditoria_Eventos`) |
| WF05 Catálogo público | `n8n/WF05_catalogo_publico.json` | Webhook `POST /webhook/eventpass/catalogo` | **EP05_Catalogo_Log** (`Consultas_Catalogo`) |
| WF06 Inscripciones CRUD | `n8n/WF06_inscripciones_crud.json` | Webhook `POST /webhook/eventpass/inscripciones` | **EP06_Inscripciones** (`Inscripciones`, `Auditoria_Inscripciones`) |
| WF07 Reasignación de lista de espera | `n8n/WF07_reasignacion_lista_espera.json` | Schedule Trigger (cada 5 min) | **EP07_Reasignaciones** (`Reasignaciones`) |
| WF08 Recordatorios | `n8n/WF08_recordatorios.json` | Schedule Trigger (cada 30 min) | **EP08_Recordatorios** (`Recordatorios`) |
| WF09 Notificaciones | `n8n/WF09_notificaciones.json` | Execute Sub-workflow Trigger | **EP09_Notificaciones** (`Notificaciones`) |
| WF10 EventPass Assistant | `n8n/WF10_eventpass_assistant.json` | Chat Trigger | **EP10_Soporte** (`Conversaciones`, `Mensajes`) |
| WF11 Check-in digital (examen) | `n8n/WF11_checkin_digital.json` | Webhook `POST /webhook/eventpass/checkin` | **EP11_Checkin** (`Checkins`) |
| WF00 Setup (auxiliar) | `n8n/WF00_setup_google_sheets.json` | Webhook (uso único) | Crea los 11 archivos anteriores con encabezados y datos de prueba (con `solo: ["EP11"]` crea solo los indicados) |

Lecturas entre dominios (solo lectura):

| Workflow | Lee además |
|---|---|
| WF01 | EP02 `Sesiones` (validar sesión para perfil/actualizar/desactivar) |
| WF02 | EP01 `Usuarios` (password y estado) |
| WF03 | EP01 `Usuarios`, EP02 `Sesiones` |
| WF04 | EP06 `Inscripciones` (no bajar capacidad bajo las confirmadas; avisar a inscritos) |
| WF05 | EP04 `Eventos`, EP06 `Inscripciones` (cálculo de cupos) |
| WF06 | EP01, EP02, EP03 `Vinculaciones`, EP04 |
| WF07 / WF08 | EP04 `Eventos`, EP06 `Inscripciones` |
| WF09 | EP01 `Usuarios` (email), EP03 `Vinculaciones` (chat_id) |
| WF10 | EP04 `Eventos`, EP06 `Inscripciones` (solo lectura, para responder sobre cupos) |

## 4. Comunicación frontend → n8n

- El frontend lee la URL pública de n8n desde `config.js`, que `scripts/build.mjs` genera a partir de variables de entorno (`N8N_BASE_URL`, `N8N_CHAT_URL`, `TELEGRAM_BOT_USERNAME`). En Vercel se definen en *Settings → Environment Variables*.
- Todas las operaciones son `POST` con cuerpo JSON a `N8N_BASE_URL/webhook/eventpass/<recurso>`, con un campo `accion` que el Switch de n8n usa para enrutar.
- Los webhooks tienen CORS habilitado (`Allowed Origins: *`) y responden con el nodo *Respond to Webhook*, que fija el código HTTP.
- Las operaciones privadas envían `session_token`; n8n lo valida contra la hoja `Sesiones` en cada solicitud.
- Se envía la cabecera `ngrok-skip-browser-warning` para evitar la página intermedia del túnel gratuito.
- La interfaz muestra los tres estados en cada operación: **carga** (esqueletos y botones con indicador), **éxito** (avisos y mensajes emergentes) y **error** (mensaje de n8n con opción de reintentar o volver a ingresar).
- El chat usa el protocolo del Chat Trigger: `POST N8N_CHAT_URL` con `{ action: "sendMessage", sessionId, chatInput, metadata: { usuario_id, visitor_id } }` y recibe `{ output }`.

## 5. Endpoints

Base: `N8N_BASE_URL/webhook/eventpass`. Todas las llamadas son `POST` con `Content-Type: application/json`.

### `/usuarios` (WF01)

| `accion` | Cuerpo | Respuesta OK |
|---|---|---|
| `crear` | `nombre`, `email`, `password` | `201` `{ usuario_id, nombre, email, estado }` |
| `perfil` | `session_token` | `200` datos del perfil |
| `actualizar` | `session_token`, `nombre?`, `password_actual?` + `password_nueva?` | `200` perfil actualizado |
| `desactivar` | `session_token`, `password` | `200` `{ estado: "INACTIVO" }` |

Errores: `DATOS_INVALIDOS` 400, `EMAIL_DUPLICADO` 409, `PASSWORD_INCORRECTA` 403, `SESION_*` 401.

### `/auth` (WF02)

| `accion` | Cuerpo | Respuesta OK |
|---|---|---|
| `login` | `email`, `password` | `200` `{ session_token, expira_en, usuario }` |
| `logout` | `session_token` | `200` `{ estado: "CERRADA" }` |
| `validar` | `session_token` | `200` `{ valida: true, expira_en, usuario }` |

Errores: `CREDENCIALES_INVALIDAS` 401, `USUARIO_INACTIVO` 401/403, `SESION_INVALIDA` / `SESION_EXPIRADA` / `SESION_CERRADA` 401.

### `/telegram` (WF03)

| `accion` | Cuerpo | Respuesta OK |
|---|---|---|
| `solicitar_codigo` | `session_token` | `201` `{ codigo, expira_en, comando }` |
| `estado` | `session_token` | `200` `{ vinculado, telegram_username?, fecha_vinculacion? }` |

En Telegram: el usuario envía `/vincular CODIGO` al bot.

### `/catalogo` (WF05)

| `accion` | Cuerpo | Respuesta OK |
|---|---|---|
| `listado` | `visitor_id?` | `200` `{ eventos[], categorias[] }` |
| `filtro` | `categoria`, `visitor_id?` | `200` `{ eventos[], categorias[], categoria }` |
| `detalle` | `evento_id`, `visitor_id?` | `200` `{ evento }` / `404` |

Cada evento incluye `capacidad`, `inscritos`, `cupos_disponibles`, `lista_espera`, `inscripcion_abierta`, `lleno` y `proximo`, calculados en el momento.

### `/inscripciones` (WF06)

| `accion` | Cuerpo | Respuesta OK |
|---|---|---|
| `crear` | `session_token`, `evento_id`, `nombre_acreditacion?`, `observaciones?` | `201` inscripción `CONFIRMADA` o `LISTA_ESPERA`; `200` si ya existía una activa |
| `mis_inscripciones` | `session_token` | `200` `{ inscripciones[] }` con datos del evento |
| `actualizar` | `session_token`, `inscripcion_id`, `nombre_acreditacion?`, `observaciones?` | `200` |
| `cancelar` | `session_token`, `inscripcion_id` | `200` (estado `CANCELADA`) |

Errores: `TELEGRAM_NO_VINCULADO` 412, `EVENTO_NO_DISPONIBLE` / `EVENTO_FINALIZADO` 409, `EVENTO_NO_ENCONTRADO` / `INSCRIPCION_NO_ENCONTRADA` 404.

### Formulario de administración (WF04)

`N8N_BASE_URL/form/eventpass-admin-eventos`, protegido con usuario y contraseña (credencial *Basic Auth* de n8n). Acciones: `CREAR`, `CONSULTAR`, `ACTUALIZAR`, `PUBLICAR`, `CERRAR`, `CANCELAR`.

### Chat (WF10)

`N8N_CHAT_URL` (la URL que muestra el nodo *Chat Trigger*, termina en `/chat`).

## 6. Estados

| Entidad | Estados | Transiciones |
|---|---|---|
| Usuario | `ACTIVO`, `INACTIVO` | ACTIVO → INACTIVO (desactivar cuenta) |
| Sesión | `ACTIVA`, `CERRADA`, `EXPIRADA` | ACTIVA → CERRADA (logout o usuario inactivo) · ACTIVA → EXPIRADA (al validarla vencida) |
| Código de vinculación | `PENDIENTE`, `USADO`, `EXPIRADO`, `CANCELADO` | PENDIENTE → USADO (vinculado) · → EXPIRADO (usado tarde) · → CANCELADO (se pidió uno nuevo) |
| Vinculación Telegram | `ACTIVA`, `INACTIVA` | — |
| Evento | `BORRADOR`, `PUBLICADO`, `CERRADO`, `CANCELADO` | BORRADOR → PUBLICADO / CANCELADO · PUBLICADO → CERRADO / CANCELADO · CERRADO → PUBLICADO / CANCELADO · CANCELADO es final |
| Inscripción | `CONFIRMADA`, `LISTA_ESPERA`, `CANCELADA`, `ASISTIO` | LISTA_ESPERA → CONFIRMADA (WF07) · CONFIRMADA / LISTA_ESPERA → CANCELADA · CONFIRMADA → ASISTIO (check-in, WF11). ASISTIO es final y sigue ocupando el cupo |
| Recordatorio | `PENDIENTE`, `ENVIADO`, `ERROR`, `OMITIDO` | — |
| Canal de notificación | `PENDIENTE`, `ENVIADO`, `ERROR`, `NO_APLICA` | Gmail y Telegram se registran por separado |
| Conversación | `ABIERTA`, `CERRADA` | ABIERTA → CERRADA (botón *Nueva* del chat envía `/cerrar`) |

En el catálogo público solo se muestran eventos **publicables**: `PUBLICADO`, `CERRADO` y `CANCELADO` (estos dos marcados y sin inscripción). `BORRADOR` nunca sale de n8n.

## 7. Hashing de contraseñas

- Se usa **PBKDF2-HMAC-SHA256** con **100 000 iteraciones**, clave de 32 bytes y **salt aleatorio de 16 bytes** por usuario (`crypto.randomBytes`), en el Code node *Generar hash, salt y usuario_id* de WF01.
- En `EP01_Usuarios` se guardan `password_hash` y `password_salt` en hexadecimal. La contraseña en texto plano nunca se guarda.
- El login (WF02, nodo *Verificar password (hash + salt)*) recalcula el hash con el salt guardado y compara con `crypto.timingSafeEqual`, para no filtrar información por tiempo de respuesta.
- Ante email inexistente o contraseña incorrecta se responde el mismo error (`CREDENCIALES_INVALIDAS`), para no revelar qué emails están registrados.
- Cambiar la contraseña genera un salt nuevo.

> El Code node usa el módulo `crypto` de Node. En n8n hay que permitirlo con la variable de entorno `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (ver la [guía de configuración](docs/GUIA_CONFIGURACION.md)).

## 8. Manejo de sesiones

- Al iniciar sesión, WF02 genera un **token opaco** de 256 bits (`crypto.randomBytes(32)`, hex) y registra en `Sesiones`: `session_id`, `usuario_id`, `session_token`, `creada_en`, `expira_en` (**8 horas**), `estado = ACTIVA`, `ultima_validacion`.
- No se usa JWT: el token no contiene datos; su validez se consulta en la hoja.
- Una sesión es inválida si **no existe**, está **CERRADA**, está **EXPIRADA** (o `expira_en` ya pasó) o pertenece a un **usuario INACTIVO**. WF02 actualiza el estado cuando detecta expiración (`EXPIRADA`) o usuario inactivo (`CERRADA`).
- `logout` marca la sesión como `CERRADA` con `cerrada_en`.
- Los demás workflows (WF01, WF03, WF06) validan el token con la misma regla, leyendo `EP02_Sesiones` y `EP01_Usuarios`.
- El frontend guarda el token en `localStorage` y lo revalida con `auth/validar` al abrir la página; si n8n responde 401, borra la sesión local.

## 9. Idempotencia

| Proceso | Clave / mecanismo |
|---|---|
| Inscripción (WF06) | `usuario_id + evento_id` no puede tener dos inscripciones activas (`CONFIRMADA` o `LISTA_ESPERA`). Si se repite la solicitud, se devuelve la inscripción existente con `ya_existia: true`, sin escribir ni notificar. |
| Cancelación (WF06) | Cancelar una inscripción ya `CANCELADA` responde 200 sin cambios. |
| Registro (WF01) | `email_normalizado` (minúsculas, sin espacios) es único: 409 `EMAIL_DUPLICADO`. |
| Código de Telegram (WF03) | Cada código pasa a `USADO` al vincular y no se acepta otra vez. Al pedir uno nuevo, los `PENDIENTE` anteriores pasan a `CANCELADO`. |
| Recordatorios (WF08) | `clave_idempotencia = usuario_id|evento_id|RECORDATORIO_24H`. Si ya existe con estado `ENVIADO` u `OMITIDO`, no se vuelve a enviar. |
| Notificaciones (WF09) | `clave_idempotencia` (por ejemplo `INSCRIPCION_CONFIRMADA|INS-…`, `REASIGNACION_CUPO|INS-…`). Si ya hay una notificación con esa clave enviada por algún canal, se omite. |
| Reasignación (WF07) | Solo promueve inscripciones en `LISTA_ESPERA`; al pasar a `CONFIRMADA` ya no vuelven a ser candidatas. |

## 10. Lista de espera y reasignación

1. Al inscribirse (WF06) se calcula `confirmadas = inscripciones CONFIRMADAS del evento`. Si `confirmadas < capacidad`, la inscripción queda `CONFIRMADA`; si no, `LISTA_ESPERA` con `orden_espera` = posición en la cola.
2. Los cupos disponibles **nunca se guardan**: se calculan siempre como `capacidad − inscripciones CONFIRMADAS` (WF05, WF06, WF07 y WF10 usan la misma fórmula).
3. Cuando alguien cancela un cupo confirmado, o el administrador aumenta la capacidad, quedan cupos libres.
4. **WF07** corre cada 5 minutos: filtra eventos `PUBLICADO` y futuros, filtra inscripciones `LISTA_ESPERA`, las **ordena por `fecha_inscripcion` ascendente** (nodo Sort), las agrupa y para cada evento promueve a las primeras `cupos libres` personas.
   - Ejemplo: 2 cupos libres y 5 en espera → posiciones 1 y 2 pasan a `CONFIRMADA`; 3, 4 y 5 siguen en `LISTA_ESPERA`.
5. Cada promoción actualiza `EP06_Inscripciones`, llama a WF09 (`REASIGNACION_CUPO`) y registra una fila en `EP07_Reasignaciones` con `orden_lista`, `estado_anterior`, `estado_nuevo` y el resultado de la notificación por canal.

## 11. Servicio central de notificaciones

WF09 es el único lugar que envía mensajes. Se invoca con *Execute Sub-workflow* desde WF04, WF06, WF07 y WF08, un ítem por notificación, con:

```json
{ "usuario_id": "...", "tipo": "INSCRIPCION_CONFIRMADA", "titulo": "...", "mensaje": "...",
  "evento_id": "...", "inscripcion_id": "...", "clave_idempotencia": "..." }
```

Flujo: validar entrada → consultar usuario (email) → consultar `chat_id` → revisar notificaciones previas (idempotencia) → **Gmail** → registrar resultado Gmail → **Telegram** (o `NO_APLICA` si no hay vinculación) → registrar resultado Telegram → guardar fila en `EP09_Notificaciones` → devolver resultado al workflow que llamó.

- Los nodos Gmail y Telegram están configurados con **On Error: Continue**, así que una falla en un canal no detiene al otro.
- `gmail_estado` / `gmail_error` y `telegram_estado` / `telegram_error` se registran por separado en la misma fila.
- Tipos usados: `INSCRIPCION_CONFIRMADA`, `LISTA_ESPERA`, `INSCRIPCION_CANCELADA`, `REASIGNACION_CUPO`, `RECORDATORIO_24H`, `EVENTO_CANCELADO`, `EVENTO_ACTUALIZADO`.

## 12. Asistente IA y sus restricciones

WF10 usa **Chat Trigger → AI Agent (Google Gemini) con memoria por conversación**.

- **conversation_id:** el `sessionId` que genera el frontend por conversación (`cnv-<uuid>`).
- **Identificación:** `usuario_id` si hay sesión iniciada; siempre `visitor_id` (identificador anónimo del navegador).
- **Persistencia:** `Conversaciones` (alta o actualización por `conversation_id`) y `Mensajes` (una fila por mensaje con rol `SYSTEM`, `USER` o `ASSISTANT` y `timestamp`). Filtrando `Mensajes` por `conversation_id` se reconstruye la conversación completa.
- **Datos:** antes de cada respuesta el workflow lee `Eventos` e `Inscripciones` (solo lectura) y arma un resumen del catálogo con cupos calculados, que se inyecta en el prompt de sistema.
- **Restricciones:** el agente **no tiene herramientas** conectadas: no puede escribir en Sheets ni llamar a otros workflows. Además, el prompt le prohíbe crear usuarios, iniciar sesión, inscribir o cancelar, modificar eventos o cupos y cambiar estados; ante esas peticiones explica dónde hacerlo en la web. Tampoco puede pedir contraseñas, tokens ni códigos.
- Enviar `/cerrar` (botón *Nueva*) marca la conversación como `CERRADA`.

## 13. Datos de prueba

WF00 crea los 11 archivos con encabezados y estos datos (las fechas se calculan al momento de crearlos):

| ID | Evento | Categoría | Situación |
|---|---|---|---|
| EVT-001 | Hackatón IA para el agro | Tecnología | PUBLICADO, **con cupos** (2/40) |
| EVT-002 | Taller: tu primer pitch en 5 minutos | Emprendimiento | PUBLICADO, **lleno** (3/3) con 2 en lista de espera |
| EVT-003 | Meetup JavaScript: lo nuevo del navegador | Tecnología | PUBLICADO, **próximo** (mañana 18:30) |
| EVT-004 | Demo Day de startups universitarias | Emprendimiento | **CANCELADO** |
| EVT-005 | Café de founders: rondas de 10 minutos | Networking | **CERRADO** (ya pasó) |
| EVT-006 | Noche de networking: devs y diseñadores | Networking | PUBLICADO, con cupos |
| EVT-007 | Bootcamp de Python para análisis de datos | Educación | PUBLICADO, con cupos |
| EVT-008 | Clínica de producto: validar antes de construir | Comunidad | BORRADOR (no visible) |

Usuarios demo `USR-DEMO01` a `USR-DEMO05` (contraseña de demostración: `EventPass2026`). Sus emails son alias `+laura`, `+andres`, etc. del correo indicado al crear los Sheets, así las notificaciones de prueba llegan a una bandeja real.

**Prueba rápida de reasignación:** ingresa como `…+laura@…` / `EventPass2026`, cancela tu inscripción en EVT-002 y espera hasta 5 minutos. Julián (posición 1) pasa a `CONFIRMADA`, aparece en `EP07_Reasignaciones` y recibe el aviso.

## 14. Variables de entorno

Archivo [`.env.example`](.env.example). Son **públicas** (terminan en el navegador); ningún secreto va aquí.

| Variable | Uso |
|---|---|
| `N8N_BASE_URL` | URL pública de n8n sin barra final, por ejemplo `https://tu-dominio.ngrok-free.app` |
| `N8N_CHAT_URL` | URL del Chat Trigger de WF10 |
| `TELEGRAM_BOT_USERNAME` | Usuario del bot (sin `@`) para el enlace `t.me/...` |

Los secretos (OAuth de Google, token del bot, API key de Gemini, usuario/contraseña del formulario de administración) se guardan **solo como credenciales cifradas dentro de n8n**. Los JSON exportados referencian las credenciales por ID y nombre, nunca su contenido.

## 15. Cómo ejecutar el proyecto

Requisitos: Node.js 18+, Docker, cuenta de Google, bot de Telegram, API key de Gemini y una cuenta gratuita de ngrok. La configuración completa, paso a paso, está en [docs/GUIA_CONFIGURACION.md](docs/GUIA_CONFIGURACION.md). En resumen:

```bash
# 1. n8n con túnel HTTPS (ver guía): WEBHOOK_URL y NODE_FUNCTION_ALLOW_BUILTIN=crypto
# 2. Crear en n8n las credenciales de Google Sheets, Gmail, Telegram, Gemini y Basic Auth
# 3. Generar los Google Sheets con datos de prueba y subir los workflows
node scripts/n8n/n8n.mjs setup-sheets tucorreo@gmail.com
node scripts/n8n/n8n.mjs push
node scripts/n8n/n8n.mjs export       # copia los workflows publicados a n8n/

# 4. Frontend local
cp .env.example .env                  # completa las URLs
npm run dev                           # http://localhost:3000
```

**Importar los workflows a mano** (alternativa al script): en n8n, *Create workflow → Import from file* con cada JSON de `n8n/`, reasignar las credenciales en los nodos que las usan, cambiar los IDs de documento de Google Sheets por los propios, apuntar los nodos *Notificar (WF09)* al ID del WF09 importado y activar cada workflow (WF09 primero).

**Publicar en Vercel:** importar el repositorio de GitHub en Vercel, definir las tres variables de entorno y desplegar. `vercel.json` ya indica el comando de build y la carpeta `dist/`.

## 16. Estructura del repositorio

```
/
├── frontend/                 código del frontend (HTML, CSS, JS, imágenes)
│   ├── index.html
│   ├── css/estilos.css
│   ├── js/app.js             rutas, vistas y estados de carga/éxito/error
│   ├── js/api.js             cliente HTTP hacia n8n (único punto de contacto)
│   ├── js/chat.js            panel del asistente
│   └── img/
├── n8n/                      workflows exportados desde la instancia de n8n (WF00–WF11)
├── docs/                     guía de configuración, arquitectura y pruebas
├── scripts/
│   ├── build.mjs             build del frontend para Vercel (genera config.js)
│   └── n8n/                  generador de workflows, datos de prueba y CLI de despliegue
├── .env.example
├── vercel.json
├── package.json
└── README.md
```

## 17. Examen — Check-in digital

### Descripción

EventPass ahora controla el **ingreso real** de los asistentes. En la entrada del evento, la persona de logística abre la vista **Check-in** del frontend (`#/checkin`), escribe el código de la inscripción y el código del evento, y pulsa *Registrar ingreso*. El frontend envía la solicitud por HTTP al nuevo workflow **WF11 — Check-in digital**, que valida, registra el intento, cambia la inscripción a `ASISTIO` y avisa al asistente por Gmail y Telegram a través de WF09.

El asistente encuentra sus códigos en **Mi cuenta → Mis inscripciones** (solo se muestran en inscripciones `CONFIRMADA`). Después del check-in la inscripción aparece como **Asististe** y ya no se puede editar ni cancelar.

Archivos nuevos o tocados:

| Archivo | Cambio |
|---|---|
| `n8n/WF11_checkin_digital.json` | Workflow exportado desde n8n |
| `scripts/n8n/wf/WF11_checkin_digital.mjs` | Generador del workflow (mismo patrón que los demás) |
| `scripts/n8n/semilla.json`, `wf/WF00_setup_google_sheets.mjs`, `n8n.mjs` | Estructura de `EP11_Checkin`; WF00 acepta `solo`; comando `setup-sheet EP11` |
| `frontend/js/api.js`, `frontend/js/app.js`, `frontend/css/estilos.css` | Vista `#/checkin`, enlace en la navegación, estado *Asististe* y códigos de ingreso |
| `WF04`, `WF05`, `WF06`, `WF07`, `WF10` | `ASISTIO` cuenta como cupo ocupado (ver *Integración*) |

### Endpoint

`POST N8N_BASE_URL/webhook/eventpass/checkin` (Webhook → … → Respond to Webhook, CORS `*`).

### Petición

```json
{ "inscripcion_id": "INS-DEMO06", "evento_id": "EVT-001" }
```

Los dos campos son obligatorios. Se aceptan en minúsculas o con espacios: n8n los normaliza a mayúsculas.

### Respuesta

Todas las respuestas traen el campo `resultado` (`EXITOSO`, `DUPLICADO` o `RECHAZADO`) además del formato común del proyecto.

**Éxito — `201`**

```json
{
  "ok": true,
  "resultado": "EXITOSO",
  "mensaje": "Check-in realizado correctamente.",
  "data": {
    "checkin": { "checkin_id": "CHK-INS-DEMO06", "inscripcion_id": "INS-DEMO06", "evento_id": "EVT-001", "usuario_id": "USR-DEMO01",
                 "fecha_checkin": "2026-10-29T12:42:34.000Z", "resultado": "EXITOSO", "detalle": "Ingreso registrado. Estado CONFIRMADA -> ASISTIO" },
    "nombre_acreditacion": "Laura Méndez",
    "evento": { "evento_id": "EVT-001", "nombre": "Hackatón IA para el agro", "lugar": "Sala Lovelace, Edificio Innovar" }
  }
}
```

**Duplicado — `409`**

```json
{ "ok": false, "resultado": "DUPLICADO",
  "error": { "codigo": "CHECKIN_DUPLICADO", "mensaje": "El ingreso ya había sido registrado (29/10/2026, 7:42:34 a. m.)." },
  "data": { "checkin_previo": { "checkin_id": "CHK-INS-DEMO06", "...": "..." } } }
```

**Rechazado — `400` / `404` / `409`**

```json
{ "ok": false, "resultado": "RECHAZADO",
  "error": { "codigo": "EVENTO_NO_CORRESPONDE", "mensaje": "Esta inscripción es del evento EVT-001, no de EVT-002." } }
```

| `error.codigo` | HTTP | Cuándo |
|---|---|---|
| `DATOS_INVALIDOS` | 400 | Falta `inscripcion_id` o `evento_id` |
| `INSCRIPCION_NO_ENCONTRADA` | 404 | La inscripción no existe |
| `EVENTO_NO_ENCONTRADO` | 404 | El evento no existe |
| `EVENTO_CANCELADO` | 409 | El evento fue cancelado |
| `EVENTO_NO_CORRESPONDE` | 409 | La inscripción es de otro evento |
| `INSCRIPCION_NO_CONFIRMADA` | 409 | La inscripción está en `LISTA_ESPERA`, `CANCELADA` u otro estado sin cupo |
| `CHECKIN_DUPLICADO` | 409 | Ya hay un check-in `EXITOSO` (resultado `DUPLICADO`) |

En la interfaz, cada resultado se muestra distinto: aviso verde *Check-in realizado correctamente* (con nombre, evento, hora y código del registro), aviso azul *Ingreso ya registrado* y aviso rojo *Check-in rechazado* con el motivo que envía n8n.

### Flujo de WF11 y validaciones

```
Webhook Check-in → Leer inscripción (EP06) → Leer evento (EP04) → Leer historial de check-in (EP11)
  → Validar solicitud → Validar inscripción y evento → Validar duplicado → Validar estado CONFIRMADA
  → Switch "Según resultado"
       EXITOSO   → Generar checkin_id → Registrar check-in (EP11) → Preparar inscripción ASISTIO → Actualizar inscripción a ASISTIO (EP06)
       DUPLICADO ┐
       RECHAZADO ┴→ Preparar registro del intento → Registrar intento (EP11)
  → Armar respuesta → Respond to Webhook → Preparar notificación → Execute Sub-workflow WF09 (solo EXITOSO)
```

Las validaciones van en este orden, y la primera que falla decide el resultado (las siguientes dejan pasar el item sin tocarlo):

1. **Datos de entrada:** llegan `inscripcion_id` y `evento_id`.
2. **La inscripción existe** en `EP06_Inscripciones`.
3. **El evento existe** en `EP04_Eventos` y no está `CANCELADO`.
4. **Correspondencia:** el `evento_id` de la inscripción es el mismo que se envió. Va antes que el duplicado para que *inscripción de EVT-001 + solicitud a EVT-002* siempre sea `RECHAZADO`.
5. **Duplicado:** no hay un check-in `EXITOSO` previo para esa inscripción, ni la inscripción está ya en `ASISTIO`.
6. **Estado:** la inscripción está en `CONFIRMADA`. `LISTA_ESPERA`, `CANCELADA` o cualquier otro estado se rechazan.

### Google Sheets: `EP11_Checkin`

Archivo nuevo e independiente (no se guarda nada del check-in dentro de `EP06_Inscripciones`, solo se actualiza el estado): [EP11_Checkin](https://docs.google.com/spreadsheets/d/16PX9wkm7VWhF_ftl8b9goC75Ep2yKesEo5gKelokB80/edit). Hoja **`Checkins`**:

| Columna | Contenido |
|---|---|
| `checkin_id` | `CHK-<inscripcion_id>` en el check-in exitoso; `CHK-<id aleatorio>` en los intentos duplicados o rechazados |
| `inscripcion_id` | Código enviado (normalizado) |
| `evento_id` | Código de evento enviado |
| `usuario_id` | Dueño de la inscripción (vacío si la inscripción no existe) |
| `fecha_checkin` | Fecha y hora ISO del intento |
| `resultado` | `EXITOSO`, `RECHAZADO` o `DUPLICADO` |
| `detalle` | Código del motivo y texto, p. ej. `INSCRIPCION_NO_CONFIRMADA (LISTA_ESPERA): …` o `CHECKIN_DUPLICADO: check-in previo CHK-INS-DEMO06` |

**Todos los intentos** quedan registrados, así se puede reconstruir qué pasó en la entrada.

Crear el archivo en una instalación que ya tiene EP01–EP10: `node scripts/n8n/n8n.mjs setup-sheet EP11` (ejecuta WF00 con `solo: ["EP11"]` y guarda el ID en `config.local.json`). En una instalación nueva, `setup-sheets` ya lo incluye.

### Cambio de estado CONFIRMADA → ASISTIO

En el camino `EXITOSO`, el nodo *Preparar inscripción ASISTIO* arma **una sola fila**: `{ inscripcion_id, estado: "ASISTIO", fecha_actualizacion: <fecha_checkin> }`. El nodo Google Sheets *Actualizar inscripción a ASISTIO* hace `update` con `inscripcion_id` como columna clave, así que solo cambia la fila de esa inscripción y solo esas dos columnas. Las demás inscripciones no se tocan.

### Cómo se evita el check-in duplicado

- **Historial:** antes de registrar se lee `Checkins` y se busca un `EXITOSO` con el mismo `inscripcion_id`.
- **Estado:** si la inscripción ya está en `ASISTIO` también es duplicado, aunque falte la fila en `Checkins`.
- **ID determinista:** el check-in exitoso usa `checkin_id = CHK-<inscripcion_id>` y se guarda con `appendOrUpdate` por `checkin_id`. Si dos solicitudes llegan casi a la vez y las dos pasan la lectura, escriben la misma fila en vez de crear dos `EXITOSO`.
- Un duplicado **no** vuelve a modificar la inscripción ni notifica: solo agrega una fila `DUPLICADO` en `Checkins` y responde `409 CHECKIN_DUPLICADO`.

### Integración con WF09 Notificaciones

WF11 no envía Gmail ni Telegram por su cuenta. Después de responder al frontend, el nodo *Notificar (WF09)* (Execute Sub-workflow) llama al servicio central con:

```json
{ "usuario_id": "USR-DEMO01", "tipo": "CHECKIN_EXITOSO", "titulo": "Ingreso registrado: Hackatón IA para el agro",
  "mensaje": "Registramos tu ingreso a …", "evento_id": "EVT-001", "inscripcion_id": "INS-DEMO06",
  "clave_idempotencia": "CHECKIN_EXITOSO|INS-DEMO06" }
```

WF09 busca el correo del usuario (EP01) y su `chat_id` (EP03), envía **Gmail + Telegram**, registra el envío en `EP09_Notificaciones` y, por la `clave_idempotencia`, no repite el aviso. Solo el resultado `EXITOSO` notifica.

### Integración con el resto del proyecto

`ASISTIO` sale de una inscripción `CONFIRMADA`, así que **sigue ocupando el cupo**. Sin este ajuste, WF07 vería un cupo libre y promovería a alguien de la lista de espera. Por eso:

- **WF05 Catálogo**, **WF06 Inscripciones** (al crear), **WF07 Reasignación**, **WF04 Eventos** (capacidad mínima) y **WF10 Asistente** cuentan `CONFIRMADA + ASISTIO` como cupos ocupados.
- **WF06**: una persona con `ASISTIO` no puede volver a inscribirse al mismo evento y no puede cancelar (`409 INSCRIPCION_CON_ASISTENCIA`).
- **WF04** también avisa a las personas con `ASISTIO` si el evento cambia.
- **WF08 Recordatorios** no cambia: solo recuerda a `CONFIRMADA`, y quien ya ingresó no necesita recordatorio.

### Casos de prueba (datos semilla)

| # | Petición | Resultado esperado |
|---|---|---|
| 1 | `INS-DEMO06` + `EVT-001` (CONFIRMADA) | `201 EXITOSO`, fila `EXITOSO` en `Checkins`, INS-DEMO06 pasa a `ASISTIO`, llegan Gmail y Telegram |
| 2 | Repetir `INS-DEMO06` + `EVT-001` | `409 DUPLICADO`, fila `DUPLICADO`, la inscripción no cambia y no se notifica |
| 3 | `INS-DEMO04` + `EVT-002` (LISTA_ESPERA) o `INS-DEMO11` + `EVT-006` (CANCELADA) | `409 RECHAZADO` `INSCRIPCION_NO_CONFIRMADA` |
| 4 | `INS-DEMO07` (de EVT-001) + `EVT-002` | `409 RECHAZADO` `EVENTO_NO_CORRESPONDE` |

Con curl:

```bash
curl -s -X POST "$N8N_BASE_URL/webhook/eventpass/checkin" -H 'Content-Type: application/json' \
  -d '{"inscripcion_id":"INS-DEMO06","evento_id":"EVT-001"}'
```

### Limitaciones conocidas

- La vista de check-in no pide sesión de organizador: el proyecto no tiene roles de staff y el examen no lo pide. Cualquiera con los dos códigos puede registrar el ingreso; como mejora se podría proteger con Basic Auth igual que el formulario de WF04.
- No se restringe el check-in a una ventana de horario del evento, para poder probar con los eventos de la semilla (que son futuros).
