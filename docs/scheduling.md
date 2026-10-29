# Programación de escenas por evento

En **Programación**, elegí **Programar escena**, una escena guardada, fecha, hora y zona horaria. También podés empezar desde **Escenas → Programar por fecha y hora**. La agenda muestra el próximo cambio, las entradas pendientes y el historial con preparación y resultado por pantalla.

Cada entrada se ejecuta una sola vez. Una escena puede programarse varias veces. Para un cambio después de medianoche, elegí la fecha del día siguiente. La zona inicial es la del evento; podés cambiarla en cada entrada. Las horas ambiguas o inexistentes por cambios de horario se rechazan. El servidor convierte la fecha local a UTC al guardar.

Guardar o editar la agenda no modifica la emisión. Podés editar o cancelar entradas mientras su hora aún no haya llegado. La cancelación queda en el historial. Las entradas terminadas se conservan; para repetirlas, creá otra programación.

## Ejecución automática

La agenda y sus resultados se guardan en SQL. `SceneScheduleService` consulta entradas cada segundo y las ejecuta en el servidor, sin depender de una pestaña abierta ni de la sesión del administrador.

- Dos minutos antes, prepara los recursos y consulta las respuestas de los Players. Una acción posterior o reconexión provoca una nueva verificación inmediata; las demás preparaciones fallidas se reintentan cada diez segundos. No altera el contenido durante la preparación.
- Al llegar la hora, **Activar las disponibles** ejecuta en las pantallas preparadas y registra las excluidas. **Esperar todas** exige que todos los destinos estén preparados.
- Si todavía no puede activar, reintenta hasta un minuto después de la hora prevista. Después registra el fallo u omisión y no muestra contenido atrasado. Una entrada posterior que ya llegó a su hora tiene prioridad en sus destinos.
- El inicio tiene la precisión del ciclo del servidor y del envío por red, con aproximadamente un segundo adicional para el inicio coordinado. No garantiza precisión de cuadro ni una hora exacta de carga de una web externa.
- Una acción manual cambia la emisión actual. Las próximas entradas siguen vigentes hasta cancelarlas. Esta primera versión no incluye recurrencias ni una pausa global de la agenda.
- Las escenas temporales mantienen su retorno automático. La limpieza de archivos del evento cancela entradas pendientes o en ejecución y conserva el historial de programación.

Los destinos, la versión y la composición de recursos quedan fijados al guardar. Una edición de la escena, sus grupos o sus recursos no se incorpora silenciosamente: la entrada falla con un motivo visible. Editá la programación antes de su preparación para confirmar la versión actual; si ya falló, creá una entrada nueva.

La preparación no garantiza disponibilidad offline de páginas web. Las TVs y el servidor deben permanecer encendidos y conectados. Una pantalla excluida no recibe automáticamente ese cambio al reconectar; las activaciones que sí se guardaron para una pantalla usan la recuperación existente del Player.

## Historial y reinicios

Cada pantalla distingue preparación, activación pendiente, aplicada, excluida, error y timeout. Un ACK de recepción no prueba reproducción: la confirmación usa la telemetría correlacionada por comando y revisión. La asignación de una web confirma el iframe, no la carga del sitio externo. El resultado observado se conserva en la agenda aunque una acción posterior cambie la pantalla.

Las preparaciones y la activación tienen identificadores persistidos. La activación usa el ID de la entrada; la sesión y los estados deseados se guardan en la misma transacción antes del envío. Al reiniciar, se recupera una activación ya guardada sin volver a mutar la reproducción. Si el proceso se interrumpió antes de registrar que terminó el envío, se reenvía el mismo comando a los destinos aún pendientes. La reconexión también recupera el último estado deseado.

Después de un reinicio, las entradas futuras continúan normalmente. Las atrasadas dentro del minuto de tolerancia intentan preparar y activar; las más antiguas se omiten. No se reproduce toda la agenda acumulada durante una caída larga.

## API

Todas las rutas requieren autenticación de administración y pertenecen al evento indicado:

- `GET /api/events/{eventId}/schedule`: agenda e historial.
- `POST /api/events/{eventId}/schedule`: crear.
- `PUT /api/events/{eventId}/schedule/{id}`: editar una entrada futura, con `version` para concurrencia optimista.
- `POST /api/events/{eventId}/schedule/{id}/cancel`: cancelar, con `{ "version": 1 }`.

Ejemplo de creación:

```json
{
  "sceneId": "00000000-0000-0000-0000-000000000001",
  "sceneVersion": 1,
  "localStartsAt": "2026-10-31T23:59:00",
  "timeZone": "America/Argentina/Buenos_Aires",
  "policy": "available"
}
```

## Despliegue

Publicar API y frontend juntos. Aplicar la migración `20261029132437_AddSceneSchedules` con el mecanismo EF existente (automático si `Database:ApplyMigrationsOnStartup=true`). Agrega `scene_schedules`; no modifica las escenas guardadas.

La ejecución requiere **una sola instancia/proceso de la API**, igual que el almacenamiento local de medios. En IIS: `Maximum Worker Processes=1`, `Start Mode=AlwaysRunning`, `Idle Time-out=0` y **Preload Enabled=True en la aplicación api**, con Application Initialization instalado. Así el servidor sigue ejecutando la agenda aunque nadie tenga abierto el panel. No es un servicio Windows independiente. Ver [despliegue](deployment.md).

La verificación automatizada usa base efímera, Players reales por SignalR y páginas web locales. Incluye ejecución con el panel cerrado, cancelación, zona horaria, reinicio entre activación y actualización de agenda, versiones, preparación parcial, reconexión e historial. El despliegue en IIS/SQL Server y las TVs físicas requieren comprobación en el entorno del evento.
