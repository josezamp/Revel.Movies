# Escenas y confirmación de pantallas

## Uso

1. En **En vivo**, elegir explícitamente una pantalla o un grupo. La tarjeta separa contenido solicitado y último contenido confirmado; una miniatura no es una captura en vivo.
2. En **Escenas**, guardar un borrador con un nombre y asignaciones por pantalla/grupo. Guardar no envía comandos.
3. Preparar la versión guardada. Cada destino informa `ready` (recursos completos en caché), `network` (requiere red), `partial`, `error`, `offline` o `timeout`. Preparar mantiene la emisión actual.
4. Activar con política `all` (esperar todos) o `available` (solamente preparados disponibles). Los omitidos aparecen como `skipped`; se pueden preparar y activar sus IDs de nuevo explícitamente.
5. Volver a la configuración anterior desde la activación. El retorno se informa como `restoring` hasta recibir telemetría del comando de restauración. Una TV desconectada conserva un estado deseado restaurado para recuperar al reconectar; no se afirma que ya lo mostró.

## Composición y restauración

Cada asignación declara `media`, `webPage` y `announcement` con `action: keep | replace | remove`. Para el fondo, `replace` usa `type: media | playlist` y su ID. `blackout` es `keep | on | off`; `promotions` es `keep | suspend`. La orientación pertenece a la pantalla y nunca a una escena.

- Mantener el fondo permite que la playlist siga avanzando debajo del anuncio o la web. Retirar esas capas revela su punto actual sin reiniciar.
- Reemplazar el fondo guarda su checkpoint. Volver restaura el archivo/playlist y la posición conocida al reemplazarlo; si estaba pausado, permanece pausado. No se promete recuperar con precisión de cuadro.
- Retirar el fondo detiene y retira esa asignación dentro de la escena. El retorno puede restaurarla desde el checkpoint guardado.
- Oscurecer usa una capa negra independiente. `display.restore` la retira y no ejecuta `media.stop`.
- Suspender cortes preserva la política previa y la restaura al volver. Mantener permite que continúen los cortes existentes.
- Guardar la configuración actual captura IDs, capas, repetición, estado pausado/detenido y checkpoint. Una cuenta regresiva ya terminada se guarda como el mensaje final que muestra.

Los grupos se resuelven a pantallas concretas. Destinos duplicados con la misma asignación se deduplican; composiciones incompatibles producen un error visible antes de modificar pantallas.

## Versiones, preparación y telemetría

`Scene.Version` usa concurrencia optimista. Editar exige la versión leída e incrementa esa versión. Cada intento persiste escena, versión, destinos, fingerprint de recursos/composición y un comando independiente por pantalla. Cambios de playlist, grupos o escena invalidan el estado preparado cuando se consulta o se intenta activar. Una acción manual posterior, una nueva preparación o una reconexión también invalidan la preparación anterior. La verificación vence a los 15 minutos; los comandos sin respuesta se marcan con timeout a los 45 segundos.

La activación guarda snapshots, estados deseados y sesión en una transacción SQL antes de enviar. Usa un inicio coordinado aproximadamente un segundo después; no promete sincronización cuadro a cuadro. `ReportPlaybackV2` incluye `commandId` y `revision`, contenido real y capas. Un ACK `received` o `applied` no prueba reproducción: la sesión se confirma con telemetría correlacionada; `Buffering`, `Loading` y `Error` no se consideran aplicación completa. Reportes viejos no sobrescriben la última confirmación ni pueden finalizar una reproducción nueva. `webPageStatus: assigned` confirma la asignación del iframe, no la carga verificable de una página externa.

Una duración de cuenta regresiva se convierte en deadline al **activar**, nunca al guardar o preparar. Una hora fija se valida nuevamente al activar.

## Temporales y reconexión

La sesión temporal guarda vencimiento y revisión por destino. Un servicio del backend revisa vencimientos cada segundo; la recuperación del Player y las consultas de sesiones también procesan los vencimientos. Sólo restaura destinos cuya sesión/revisión sigue vigente. Cualquier decisión manual posterior prevalece. Las sesiones permanecen aunque se elimine la definición de la escena para permitir restauración y trazabilidad.

Al volver de una escena que cubría otra temporal, se omiten snapshots temporales ya vencidos. Si la temporal anterior todavía está vigente, conserva su vencimiento. El Player descarta comandos temporales vencidos; al reconectar recupera el estado vigente y debe volver a verificar recursos preparados.

## API

- `GET/POST /events/{eventId}/scenes`
- `PUT/DELETE /events/{eventId}/scenes/{sceneId}`
- `POST /events/{eventId}/scenes/{sceneId}/duplicate`
- `POST /events/{eventId}/scenes/snapshot` con `{ name, displayIds }`
- `POST /events/{eventId}/scenes/{sceneId}/prepare` con `{ version, displayIds? }`
- `POST /events/{eventId}/scenes/{sceneId}/activate` con `{ version, preparationId, policy: "all" | "available", displayIds? }`
- `GET /events/{eventId}/scene-sessions` (últimos 50 intentos)
- `GET /scene-sessions/{id}` y `POST /scene-sessions/{id}/restore`
- `PUT /displays/{id}/settings` admite `name?` y `rotation?`, incluso sin conexión de la TV.

Contratos tipados: `apps/api/RevelMovies.Api/Runtime/SceneContracts.cs`. Los eventos SignalR son `scene.prepare`, `scene.apply` y `scene.restore`; se conserva el canal `command` existente.

## Despliegue y validación

Aplicar `20261025222149_AddScenesAndPlaybackConfirmation` (automático con `Database:ApplyMigrationsOnStartup=true`). Crea `scenes` y `scene_sessions`, agrega revisión/correlación/capas confirmadas y convierte blackouts previos a capa independiente. Publicar API y frontend/Player juntos; los Players anteriores no implementan comandos de escena.

Las pruebas del backend cubren renombrado offline sin pérdida de identidad, guardar/preparar sin modificar emisión, preparación parcial y versiones, ACKs viejos, activación parcial, capas/telemetría, grupos superpuestos, snapshot pausado, vencimientos, retornos protegidos, reconexión y coherencia de migración. Se requieren TVs físicas para validar restricciones del navegador, reproducción automática, orientación real, cuotas de almacenamiento y comportamiento de red particular del evento. HTTP LAN, caché no disponible, contenido externo o archivos demasiado grandes pueden requerir red; `network` no promete disponibilidad offline.
