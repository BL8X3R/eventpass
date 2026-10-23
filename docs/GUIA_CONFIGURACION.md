# Guía de configuración de EventPass

Esta guía deja listo todo lo que vive fuera del código: n8n accesible desde internet, las cuentas de Google, Telegram y Gemini, y la publicación en Vercel.

**Regla de oro:** los secretos (tokens, contraseñas, client secret, API keys) se escriben **solo dentro de n8n** o en tu terminal. Nunca en el chat, en el repositorio ni en el `.env`.

Tiempo aproximado: 45–60 minutos.

---

## Paso 1. API key de n8n (5 min)

Permite que los scripts del proyecto creen y activen los workflows en tu n8n.

1. Abre <http://localhost:5678> e inicia sesión.
2. Abajo a la izquierda: tu usuario → **Settings** → **n8n API** → **Create an API key**. Nombre: `eventpass-cli`. Sin expiración (o 90 días). Copia la clave.
3. Guárdala en tu equipo con este comando (pega la clave cuando lo pida y pulsa Enter):

   ```bash
   mkdir -p ~/.config/eventpass && read -rsp "API key de n8n: " K && printf '%s' "$K" > ~/.config/eventpass/n8n_api_key && chmod 600 ~/.config/eventpass/n8n_api_key && echo && echo "Guardada"
   ```

## Paso 2. Túnel HTTPS con ngrok (10 min)

Vercel y Telegram necesitan llegar a tu n8n por una URL pública con HTTPS. ngrok gratis da **un dominio fijo** que no cambia aunque reinicies.

1. Crea una cuenta en <https://dashboard.ngrok.com/signup>.
2. En el panel: **Your Authtoken** → copia el token.
3. En el panel: **Domains** (o *Universal Gateway → Domains*) → **Create Domain / New Domain**. Te asigna uno gratis, parecido a `algo-algo-1234.ngrok-free.app`. Cópialo.
4. Arranca el túnel como contenedor (se reinicia solo con el PC). Reemplaza los dos valores:

   ```bash
   docker run -d --name ngrok --restart unless-stopped --network host \
     -e NGROK_AUTHTOKEN='PEGA_AQUI_TU_AUTHTOKEN' \
     ngrok/ngrok:latest http --url=PEGA_AQUI_TU_DOMINIO 5678
   ```

5. Comprueba: abre `https://TU_DOMINIO/healthz` en el navegador (si aparece el aviso de ngrok, pulsa **Visit Site**). Debe decir `{"status":"ok"}`.
   - Si sale **404**, el túnel apunta al puerto equivocado: el número final del comando debe ser **5678** (el de n8n), no 80. Detén el túnel y vuelve a crearlo.
   - No uses `ngrok http ...` directamente en una terminal: se apaga al cerrarla. El contenedor se reinicia solo.

**Pásame el dominio** (no es secreto). Con él reconfiguro tu contenedor de n8n (Paso 3).

## Paso 3. Reconfigurar el contenedor de n8n (lo hago yo)

Hay que recrear el contenedor `n8n` con dos cambios. Tus datos están en el volumen `n8n_data` y **no se pierden**:

- `WEBHOOK_URL=https://TU_DOMINIO/`: para que los webhooks y el Telegram Trigger usen la URL pública.
- `NODE_FUNCTION_ALLOW_BUILTIN=crypto`: para que los Code nodes puedan calcular hash, salt y tokens.
- `N8N_EDITOR_BASE_URL=http://localhost:5678/`: mantiene la URL de retorno de OAuth en `localhost`. Sin esta variable, n8n usa el dominio público como redirect y Google responde `Error 400: redirect_uri_mismatch`.

Comando de referencia:

```bash
docker stop n8n && docker rm n8n
docker run -d --name n8n --restart unless-stopped -p 5678:5678 -v n8n_data:/home/node/.n8n \
  -e GENERIC_TIMEZONE=America/Bogota -e TZ=America/Bogota -e N8N_HOST=localhost \
  -e N8N_EDITOR_BASE_URL=http://localhost:5678/ \
  -e WEBHOOK_URL=https://TU_DOMINIO/ -e N8N_PROXY_HOPS=1 \
  -e NODE_FUNCTION_ALLOW_BUILTIN=crypto \
  docker.n8n.io/n8nio/n8n
```

## Paso 4. Google Cloud: Sheets y Gmail (20 min)

Es el paso más largo. Se hace una vez y sirve para Sheets y Gmail.

1. Entra a <https://console.cloud.google.com/> con la cuenta de Gmail que enviará las notificaciones.
2. Arriba: selector de proyectos → **New project** → nombre `EventPass` → **Create**. Selecciónalo.
3. **APIs & Services → Library**. Busca y pulsa **Enable** en cada una:
   - Google Sheets API
   - Google Drive API
   - Gmail API
4. **APIs & Services → OAuth consent screen** (o *Google Auth Platform → Branding*):
   - Tipo de usuario: **External** → nombre de la app `EventPass`, tu email como soporte y contacto → guardar.
   - **Audience / Test users** → **Add users** → agrega tu propio Gmail. Sin esto Google rechaza el inicio de sesión.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID** (o *Clients → Create client*):
   - Application type: **Web application**. Nombre: `n8n EventPass`.
   - **Authorized redirect URIs → Add URI:** `http://localhost:5678/rest/oauth2-credential/callback`
   - **Create**. Copia el **Client ID** y el **Client secret**.
6. En n8n: **Overview → Create → Credential**.
   - Busca **Google Sheets OAuth2 API**. Pega Client ID y Client secret. Nombre de la credencial, **exactamente**: `Google Sheets EventPass`. Pulsa **Sign in with Google**, elige tu cuenta y acepta (si aparece "Google hasn't verified this app": *Continue*). Guarda.
   - Repite con **Gmail OAuth2 API**, mismo Client ID y secret. Nombre: `Gmail EventPass`. Sign in, aceptar, guardar.

## Paso 5. Bot de Telegram (5 min)

1. En Telegram abre **@BotFather** → `/newbot`.
2. Nombre visible: `EventPass`. Usuario: algo que termine en `bot`, por ejemplo `EventPassTuNombreBot`.
3. BotFather te da un **token** (`123456:ABC...`). Cópialo.
4. En n8n: **Create → Credential → Telegram API**. Pega el token. Nombre: `Telegram EventPass`. Guarda.

**Pásame el usuario del bot** (sin el token).

## Paso 6. API key de Gemini (3 min)

1. Abre <https://aistudio.google.com/apikey> → **Create API key** (elige el proyecto `EventPass`). Cópiala.
2. En n8n: **Create → Credential → Google Gemini(PaLM) Api**. Pega la key (el host se deja como está). Nombre: `Gemini EventPass`. Guarda.

## Paso 7. Acceso de administrador al formulario de eventos (2 min)

El formulario de WF04 es una URL pública; esta credencial la protege con usuario y contraseña.

1. En n8n: **Create → Credential → Basic Auth**.
2. Usuario: `admin`. Contraseña: una que inventes (no la de tu correo). Nombre: `Admin EventPass`. Guarda.

## Paso 8. Avísame

Cuando termines los pasos 1 a 7, envíame:

- tu **nombre completo** para el README;
- el **dominio de ngrok**;
- el **usuario del bot** de Telegram;
- el **correo base** para los usuarios demo (puede ser tu mismo Gmail: los demo usarán alias como `tucorreo+laura@gmail.com`, que llegan a tu bandeja).

Con eso yo:

1. recreo el contenedor de n8n (Paso 3);
2. creo los 10 Google Sheets con datos de prueba (`node scripts/n8n/n8n.mjs setup-sheets`);
3. subo y activo los 10 workflows (`push`) y los pruebo de punta a punta;
4. exporto los JSON a `n8n/` (`export`).

## Paso 9. GitHub y Vercel (después de las pruebas)

1. **GitHub:** crea un repositorio **vacío** (sin README) llamado `eventpass` en <https://github.com/new> y pásame la URL. Yo hago el commit; el `git push` pedirá tu usuario y un *Personal Access Token* (<https://github.com/settings/tokens>, permiso `repo`), que escribes tú en la terminal.
2. **Vercel:** entra a <https://vercel.com> con tu cuenta de GitHub → **Add New → Project** → importa `eventpass`.
   - Framework preset: **Other** (el `vercel.json` ya define build y carpeta de salida).
   - **Environment Variables**: `N8N_BASE_URL`, `N8N_CHAT_URL`, `TELEGRAM_BOT_USERNAME` (te paso los valores exactos).
   - **Deploy**. Pásame la URL `https://….vercel.app` para ponerla en el README.

## Para el día de la entrega

La URL de Vercel solo funciona si **tu PC está encendido** con Docker corriendo (n8n y ngrok tienen `--restart unless-stopped`, así que arrancan solos al prender el equipo). Antes de la revisión abre `https://TU_DOMINIO/healthz` para confirmarlo.
