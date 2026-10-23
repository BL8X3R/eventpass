# EventPass

**Estudiante:** Fabian
**Aplicación publicada (Vercel):** _URL DE VERCEL_
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

---

## 1. Arquitectura general

```
 Navegador (Vercel: HTML/CSS/JS estático)
        │  fetch POST JSON            │  Chat (POST /chat)
        ▼                             ▼
 ┌──────────────────────── n8n (Docker + túnel HTTPS) ────────────────────────┐
 │  WF01 Usuarios   WF02 Auth   WF03 Telegram   WF05 Catálogo   WF06 Inscrip.  │
 │  WF04 Admin (Form)   WF07 Reasignación (cron)   WF08 Recordatorios (cron)   │
 │  WF10 Assistant (Chat Trigger + Gemini)                                     │
 │                  │ Execute Sub-workflow                                     │
 │                  ▼                                                          │
 │           WF09 Notificaciones ──► Gmail  +  Telegram                        │
 └─────────────────────────────────┬──────────────────────────────────────────┘
                                   ▼
          Google Sheets (10 archivos independientes: EP01 … EP10)
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
| Persistencia | Google Sheets (10 archivos) |
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
| WF00 Setup (auxiliar) | `n8n/WF00_setup_google_sheets.json` | Webhook (uso único) | Crea los 10 archivos anteriores con encabezados y datos de prueba |

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
| Inscripción | `CONFIRMADA`, `LISTA_ESPERA`, `CANCELADA` | LISTA_ESPERA → CONFIRMADA (WF07) · CONFIRMADA / LISTA_ESPERA → CANCELADA |
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

WF00 crea los 10 archivos con encabezados y estos datos (las fechas se calculan al momento de crearlos):

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
├── n8n/                      workflows exportados desde la instancia de n8n (WF00–WF10)
├── docs/                     guía de configuración, arquitectura y pruebas
├── scripts/
│   ├── build.mjs             build del frontend para Vercel (genera config.js)
│   └── n8n/                  generador de workflows, datos de prueba y CLI de despliegue
├── .env.example
├── vercel.json
├── package.json
└── README.md
```
