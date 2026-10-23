# Guion de pruebas de EventPass

Recorrido para demostrar cada requisito. Cada paso indica qué hoja de Google Sheets revisar.

| # | Acción | Resultado esperado | Dónde verificar |
|---|---|---|---|
| 1 | Abrir la URL de Vercel sin sesión | Catálogo con 7 eventos (EVT-008 en BORRADOR no aparece); EVT-002 marcado *Lleno*, EVT-004 *Cancelado*, EVT-005 *Inscripciones cerradas* | `EP05_Catalogo_Log › Consultas_Catalogo` (tipo `LISTADO`) |
| 2 | Pulsar el filtro *Networking* | Solo EVT-005 y EVT-006 | `Consultas_Catalogo` (tipo `FILTRO`) |
| 3 | Abrir un evento | Detalle con casillas de cupos | `Consultas_Catalogo` (tipo `DETALLE`) |
| 4 | Crear cuenta con un email nuevo | Cuenta creada y sesión iniciada | `EP01 › Usuarios` (hash y salt, ACTIVO), `Auditoria_Usuarios`, `EP02 › Sesiones` (ACTIVA) |
| 5 | Crear cuenta otra vez con el mismo email | Error "Ya existe una cuenta con ese email" | `Auditoria_Usuarios` (ERROR) |
| 6 | Intentar inscribirse sin Telegram | Aviso "Falta vincular Telegram" | — |
| 7 | Mi cuenta › Telegram › Generar código; enviar `/vincular CODIGO` al bot | El bot confirma; la web muestra *Telegram vinculado* | `EP03 › Codigos_Vinculacion` (USADO), `Vinculaciones` (ACTIVA) |
| 8 | Reenviar el mismo `/vincular CODIGO` | El bot responde "Ese código ya fue usado" | — |
| 9 | Inscribirse en EVT-001 | *Inscripción confirmada*; llegan Gmail y Telegram | `EP06 › Inscripciones` (CONFIRMADA), `Auditoria_Inscripciones`, `EP09 › Notificaciones` (ENVIADO/ENVIADO) |
| 10 | Volver a inscribirse en EVT-001 (otra pestaña o petición repetida) | "Ya tienes tu cupo confirmado" sin fila nueva | `Auditoria_Inscripciones` (OMITIDO) |
| 11 | Inscribirse en EVT-002 (lleno) | Queda en lista de espera (posición 3); llegan avisos | `Inscripciones` (LISTA_ESPERA, orden_espera 3) |
| 12 | Salir de la sesión, ingresar como `<correo>+laura@…` / `EventPass2026` y cancelar EVT-002 | Cupo liberado | `Inscripciones` (CANCELADA) |
| 13 | Esperar hasta 5 minutos | Julián (USR-DEMO04, el primero en espera) pasa a CONFIRMADA y recibe Gmail; Telegram `NO_APLICA` | `EP07 › Reasignaciones`, `EP09 › Notificaciones` |
| 14 | Esperar el siguiente ciclo de WF08 (≤ 30 min, cuando EVT-003 esté a menos de 24 h) | Recordatorio a los confirmados de EVT-003 | `EP08 › Recordatorios` (ENVIADO, clave_idempotencia) |
| 15 | Ejecutar WF08 de nuevo | No se reenvía | `Recordatorios` sin filas nuevas para la misma clave |
| 16 | Formulario de administración: CREAR evento en BORRADOR, luego PUBLICAR | Aparece en el catálogo | `EP04 › Eventos`, `Auditoria_Eventos` |
| 17 | Formulario: CANCELAR un evento con inscritos | Los inscritos reciben aviso | `Eventos` (CANCELADO), `Notificaciones` (EVENTO_CANCELADO) |
| 18 | Asistente: "¿Qué eventos de networking hay?" | Responde con datos reales del catálogo | `EP10 › Conversaciones`, `Mensajes` (SYSTEM, USER, ASSISTANT) |
| 19 | Asistente: "Inscríbeme en el hackatón" | Explica que no puede y dónde hacerlo | `Mensajes` |
| 20 | Mi cuenta › Perfil › Desactivar cuenta | Sesión cerrada; ya no puede ingresar | `Usuarios` (INACTIVO), `Auditoria_Usuarios` |
