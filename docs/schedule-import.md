# Armar la programación con ChatGPT

En **Programación** podés copiar el contexto del evento para un chat e importar su respuesta como JSON. Revel crea las escenas y sus horarios juntos, después de que revises la vista previa. El chat no necesita acceso a tu servidor.

## Paso a paso

1. Cargá los videos e imágenes, armá las playlists y vinculá las pantallas del evento.
2. Abrí **Programación → Copiar contexto para ChatGPT**. Copiá el texto o descargalo si el navegador no permite usar el portapapeles.
3. Pegalo en el chat junto con tu cronograma. Por ejemplo: «El 14 de noviembre de 2026, de 21 a 00 quiero la playlist Previa en las pantallas del salón; de 00 a 01, Sponsors; a la 01, volver a Previa. Usá la zona horaria del evento».
4. Volvé a **Programación → Importar JSON**. Pegá la respuesta o elegí el archivo `.json`.
5. Validá y revisá las fechas, las pantallas, el contenido, las capas y las advertencias. Confirmá la importación para guardar.

El contexto contiene los identificadores y nombres reales del evento. Si cambia el catálogo, volvé a copiarlo. Para elegir «algo relacionado con la previa», el chat debe usar los archivos o playlists disponibles; importar JSON no genera videos ni sube archivos.

## Horarios y cambio de día

La agenda contiene **cambios de escena**, no intervalos con una hora final implícita. «De 21 a 00, previa; de 00 a 01, anuncios» necesita tres entradas:

| Fecha y hora local | Escena |
| --- | --- |
| 14/11/2026 21:00 | Previa |
| 15/11/2026 00:00 | Sponsors |
| 15/11/2026 01:00 | Previa, Fiesta u otra escena elegida para después |

Una escena sin duración temporal continúa hasta que otro cambio la reemplace. Si querés apagar las pantallas al finalizar, pedí una escena de cierre con oscurecimiento y programala a esa hora. Una escena temporal vuelve al estado anterior al vencer; no equivale a elegir una escena de cierre.

Las fechas deben estar en el futuro. Los horarios son locales a `timeZone` y deben incluir la fecha completa. Revel rechaza horas ambiguas o inexistentes por cambios de horario y cambios simultáneos incompatibles sobre las mismas pantallas.

## Formato versión 1

El contexto generado por Revel incluye las instrucciones y el formato admitido. El paquete tiene estos campos:

| Campo | Contenido |
| --- | --- |
| `schemaVersion` | `1` |
| `eventId` | Identificador del evento seleccionado |
| `timeZone` | Zona horaria para todas las entradas del paquete |
| `scenes` | Escenas nuevas con una `key` única, nombre, asignaciones y duración temporal opcional |
| `schedule` | Cambios con `sceneKey`, `localStartsAt` y `policy` |

`key` es una referencia interna del paquete, por ejemplo `previa`. Los IDs de pantallas, grupos, archivos y playlists deben provenir del catálogo de Revel. Los nombres sirven para leer la propuesta; no reemplazan los IDs.

Cada asignación declara `displayIds`, `groupIds`, `media`, `webPage`, `announcement`, `blackout` y `promotions`, según el [protocolo de escenas](scenes.md). Las acciones `keep`, `replace` y `remove` permiten controlar cada capa explícitamente. Al pasar de anuncios a una playlist, pedí retirar el anuncio si no debe seguir visible.

Ejemplo con IDs ilustrativos: reemplazalos por los del contexto del evento y elegí fechas futuras.

```json
{
  "schemaVersion": 1,
  "eventId": "00000000-0000-0000-0000-000000000001",
  "timeZone": "America/Argentina/Buenos_Aires",
  "scenes": [
    {
      "key": "previa",
      "name": "Previa",
      "assignments": [{
        "displayIds": ["00000000-0000-0000-0000-000000000002"],
        "groupIds": [],
        "media": {
          "action": "replace", "type": "playlist",
          "playlistId": "00000000-0000-0000-0000-000000000003", "loop": true
        },
        "webPage": { "action": "remove" },
        "announcement": { "action": "remove" },
        "blackout": "off",
        "promotions": "suspend"
      }]
    },
    {
      "key": "sponsors",
      "name": "Sponsors",
      "assignments": [{
        "displayIds": ["00000000-0000-0000-0000-000000000002"],
        "groupIds": [],
        "media": {
          "action": "replace", "type": "playlist",
          "playlistId": "00000000-0000-0000-0000-000000000004", "loop": true
        },
        "webPage": { "action": "remove" },
        "announcement": { "action": "remove" },
        "blackout": "off",
        "promotions": "suspend"
      }]
    }
  ],
  "schedule": [
    { "sceneKey": "previa", "localStartsAt": "2026-11-14T21:00", "policy": "available" },
    { "sceneKey": "sponsors", "localStartsAt": "2026-11-15T00:00", "policy": "available" },
    { "sceneKey": "previa", "localStartsAt": "2026-11-15T01:00", "policy": "available" }
  ]
}
```

`available` activa las pantallas preparadas y registra las excluidas. `all` espera que todas estén disponibles, con el margen de ejecución del [programador](scheduling.md).

Cada paquete admite hasta 1 MiB de JSON, 100 escenas, 300 cambios de horario y 500 asignaciones en total. Cada escena admite hasta 100 asignaciones; cada asignación, hasta 500 IDs de pantallas y grupos combinados. Las claves de escena deben ser únicas y todas las escenas deben usarse en la agenda. Se rechazan campos desconocidos o repetidos para evitar interpretar una intención distinta de la escrita.

## Validación, reintentos y cambios posteriores

La vista previa no guarda escenas, no programa entradas y no envía comandos. Si editás el JSON, hay que validarlo nuevamente. Al confirmar, el servidor vuelve a comprobar el contenido, los destinos y la agenda; si la propuesta quedó desactualizada, pedirá una nueva revisión.

La importación agrega escenas y horarios: no reemplaza ni elimina los existentes. Si una parte es inválida o falla el guardado, no se conserva una importación parcial. Repetir el mismo paquete recupera el resultado original sin duplicar escenas ni entradas, incluso si se perdió la respuesta del servidor. Esto no vuelve a crear entradas que después hayas cancelado o escenas que hayas editado o eliminado.

Después de importar, podés editar escenas y horarios desde sus secciones habituales. Si cambiás una escena, sus grupos o recursos, actualizá también su programación para confirmar esos cambios.

El servidor y las pantallas deben seguir encendidos y conectados. La ejecución usa el programador existente y no depende del chat ni de mantener abierto el panel.

## API

Estas rutas requieren la sesión de administración:

- `GET /api/events/{eventId}/schedule/import-context`: devuelve `{ "prompt": "..." }` con el contexto para el chat.
- `POST /api/events/{eventId}/schedule/preview-import`: recibe el paquete y devuelve escenas, horarios, destinos, advertencias y `previewToken`.
- `POST /api/events/{eventId}/schedule/import`: recibe `{ "package": { ... }, "previewToken": "..." }` y devuelve `alreadyImported`, `sceneCount` y `scheduleCount`.

El token corresponde a la propuesta revisada. No reemplaza la autenticación ni debe inventarse. Para recuperar una importación repetida se puede volver a validar el mismo paquete.

## Despliegue

Publicá API y frontend juntos y aplicá `20261031130000_AddSceneScheduleImports` con el mecanismo EF existente (automático con `Database:ApplyMigrationsOnStartup=true`). La tabla `scene_schedule_imports` conserva los comprobantes de importación para reconocer reintentos incluso después de reiniciar el servidor.

Se mantiene el requisito del programador y del almacenamiento local: una sola instancia/proceso de la API. La importación no requiere configurar una API de ChatGPT: el intercambio se hace copiando contexto y trayendo el JSON generado.
