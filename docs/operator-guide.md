# Operar un evento en Revel Movies

## Acceso al panel

Abrí `/admin` e ingresá con el usuario y la contraseña configurados por el administrador del servidor. La sesión dura hasta 7 días; usá **Cerrar sesión** al terminar. Si vence, volvé a ingresar: el enlace conserva el evento y la sección que estabas usando. Las TVs siguen funcionando con su vinculación habitual y no necesitan la contraseña del panel.

Si aparece “El acceso al panel todavía no está configurado”, completá la [configuración del servidor](deployment.md#administrator-login).

## El panel

El evento activo permanece en la cabecera. El panel separa cinco tareas: **En vivo**, **Escenas**, **Programación**, **Contenido** y **Configuración**. Los destinos de reproducción se eligen explícitamente; si desaparecen, el panel pide elegirlos otra vez.

Desde el inicio, **Controlar mi evento** abre el panel para la computadora o el celular; **Conectar una pantalla** abre el reproductor en la TV. Si todavía no hay eventos, **Crear mi primer evento** inicia la preparación.

El nombre del evento encabeza el panel. El evento y la sección seleccionados se conservan en la dirección del navegador: podés recargar, guardar el enlace o usar Atrás sin perder ese contexto. Si un enlace apunta a un evento que ya no está disponible, el panel pide elegir uno; nunca cambia a otro automáticamente. **Panel conectado** indica que el panel recibe datos del servidor; la conexión de cada TV se muestra por separado en su tarjeta.

## En vivo

Cada tarjeta muestra el último reporte recibido del reproductor: archivo actual, playlist e índice, posición, duración, repetición y capas. Pantalla negra tiene prioridad; después anuncios, página web y multimedia de fondo. Una página externa se identifica como asignación de iframe: no es posible garantizar que el sitio externo haya cargado o permitido su inserción.

La miniatura es una referencia del archivo, no una captura en vivo. El progreso corresponde a la última posición reportada, sin avance estimado. Después de 15 segundos sin reportes, el estado queda marcado como desactualizado. La conexión con la TV es independiente: una TV desconectada puede seguir reproduciendo localmente. Si falla la conexión del panel con la API, se conserva la información y se muestra el aviso de actualización pendiente.

Las acciones de reproducción quedan esperando confirmación. La aceptación HTTP y el ACK de recepción no prueban que haya comenzado la reproducción; la confirmación usa el identificador de comando y la revisión reportados por el Player. Una acción anterior no confirma una nueva.

- **Pausar / Reanudar:** cambia el estado del contenido actual.
- **Detener contenido:** detiene la multimedia; las capas independientes conservan su configuración.
- **Oscurecer pantalla / Restaurar imagen:** oculta o revela las capas sin detener el fondo.
- **Retirar anuncio / Retirar página:** elimina esa capa y revela lo que seguía debajo.
- **Renombrar:** conserva la identidad, vinculación, evento, grupos, referencias y reproducción; funciona con la TV desconectada.
- **Identificar:** muestra nombre e identificador breve durante unos segundos, con la orientación física de la pantalla.

En **Detalles** se encuentran orientación, diagnóstico, recarga y desvinculación. La recarga interrumpe brevemente el reproductor; desvincular requiere confirmación y una nueva vinculación para volver a usarlo.

### Mapa del evento

En **En vivo**, alterná entre **Tarjetas** y **Mapa**. Cada evento tiene su propio croquis, guardado en el servidor y disponible desde otras computadoras. La vista elegida se conserva en la dirección del navegador.

- **Editar croquis:** agregá sectores rectangulares, círculos, paredes y etiquetas. Seleccioná un elemento para cambiar su texto, color, posición y tamaño. Una pared puede ser horizontal o vertical ajustando su ancho y alto. El selector de elementos permite elegir figuras superpuestas.
- **Cambiar tamaño con el mouse o el dedo:** seleccioná un elemento y arrastrá sus tiradores. Los bordes ajustan una dimensión; las esquinas ajustan ancho y alto. Las paredes muestran tiradores en sus cuatro bordes para cambiar longitud y grosor. Los tiradores también aceptan flechas del teclado (5 unidades, o 20 con Mayús). Escape cancela el arrastre y restaura el tamaño y la posición anteriores. El elemento conserva un tamaño mínimo y permanece dentro del lienzo, incluso con zoom. Los cambios se guardan con **Guardar croquis** y los tiradores desaparecen en **Operar**.
- **Ubicar pantallas:** elegí una de las pantallas sin ubicar y arrastrala hasta su lugar. También podés usar las coordenadas del panel o las flechas del teclado: 5 unidades por pulsación, o 20 con Mayús. El croquis es orientativo, sin escala física. Los botones de zoom y el desplazamiento del lienzo permiten recorrerlo en el celular.
- **Guardar croquis:** persiste figuras y posiciones para ese evento. Cambiar de evento o de vista conserva un borrador en esta pestaña cuando el navegador permite almacenamiento local. Si cerrás o recargás con cambios pendientes, el navegador avisa. El borrador local no reemplaza el guardado en el servidor.
- **Operar:** guarda los cambios pendientes y bloquea las posiciones. Seleccioná una pantalla para acceder a sus controles habituales y al último estado reportado. Editar el croquis no envía comandos de reproducción. Las pantallas sin ubicar también se pueden operar desde el panel lateral.
- **Quitar del croquis:** retira solamente el marcador; conserva la pantalla vinculada y su reproducción. Si una pantalla se desvincula, su marcador queda señalado para que puedas quitarlo al editar.

Si otra sesión guardó cambios, el panel rechaza la escritura antigua y conserva tu borrador visible. **Cargar versión guardada** pide confirmar el descarte del borrador antes de traer la última versión. Un error de red conserva los cambios pendientes y permite reintentar. El límite es de 300 elementos por evento.

## Escenas: guardar, preparar y activar

1. Crear una escena y agregar asignaciones. Cada asignación puede apuntar a pantallas o grupos. El editor muestra los destinos concretos y detecta composiciones incompatibles por grupos superpuestos.
2. Para multimedia, página y anuncio, elegir **Mantener**, **Reemplazar** o **Retirar**. Pantalla negra tiene su política independiente. Los cortes promocionales pueden mantenerse o suspenderse: la suspensión evita próximos cortes y deja terminar uno ya iniciado.
3. **Guardar borrador** persiste una versión sin tocar las pantallas. Se puede guardar sin asignaciones y completarlo después. Editar, duplicar y renombrar son operaciones de configuración.
4. **Preparar recursos** verifica los medios mientras continúa la emisión. El resultado se muestra por pantalla: lista en caché, disponible por red, parcial, error, sin conexión o vencida. No se publican porcentajes estimados.
5. Elegir entre esperar todas las pantallas o activar solo las disponibles, dejando visibles las excluidas. **Activar [nombre] en N pantallas** aplica una versión concreta. Cada destino pasa de pendiente a aplicado únicamente con telemetría correlacionada.

Cambiar la escena, los recursos de una playlist o los integrantes de un grupo invalida la preparación. Una reconexión exige verificar de nuevo. La preparación vence a los 15 minutos. La caché depende del soporte del navegador y de un contexto seguro (HTTPS o localhost); en HTTP de una LAN puede ser necesario reproducir por red. El límite de caché por archivo es 256 MiB. No se promete disponibilidad offline de webs, archivos fuera del límite ni recursos que no se pudieron almacenar.

Las cuentas regresivas por duración comienzan al activar; guardar y preparar no inician el reloj. Una hora fija se vuelve a validar al activar. El inicio coordinado reduce diferencias entre destinos, sin garantía de sincronización cuadro a cuadro.

**Guardar configuración actual** captura las pantallas elegidas y sus capas solicitadas. El nombre de la pantalla nunca es su identificador de destino. Una captura conserva el estado y posición del fondo cuando corresponde. La vista previa describe una configuración futura; no representa la emisión actual.

## Programación por fecha y hora

En **Programación → Programar escena**, elegí una escena guardada, fecha, hora, zona horaria y la política para pantallas no disponibles. También podés programar desde cada tarjeta de Escenas. Las entradas se preparan automáticamente dos minutos antes y se activan desde el servidor aunque cierres el panel. El servidor y las pantallas deben permanecer encendidos y conectados.

La agenda muestra el próximo cambio y permite editar o cancelar entradas futuras. El historial detalla la preparación y la confirmación por pantalla. Para después de medianoche elegí la fecha del día siguiente. Si no se puede ejecutar dentro del minuto posterior al horario, la entrada se omite o falla y queda registrada. Los cambios manuales no cancelan las próximas entradas.

La versión y los destinos se confirman al guardar: si cambiás una escena, sus grupos o sus recursos, actualizá su programación. Ver [programación, recuperación y configuración de IIS](scheduling.md).

## Retorno y escenas temporales

Cada activación conserva el estado anterior de sus destinos. **Volver a la configuración anterior** usa ese estado:

- Cuando la escena mantuvo el fondo, retirar sus capas revela el contenido que siguió avanzando.
- Cuando lo reemplazó, restaura la posición guardada y el estado de pausa. No es equivalente a reiniciar desde el primer archivo.
- El retorno afecta únicamente a los destinos de esa activación. El historial permite volver sobre activaciones parciales anteriores.
- Una decisión manual posterior tiene prioridad: el retorno automático no la sobrescribe.

La duración temporal se cuenta desde la activación coordinada. El servidor conserva la fecha de vencimiento y restaura el estado vigente incluso si la TV está desconectada. Una escena vencida no se reproduce tardíamente al reconectar. El Player también retira localmente una escena temporal si pierde la conexión. La UI distingue retorno enviado de retorno confirmado.

## Contenido y publicación de cambios

Biblioteca, Playlists y Promociones tienen pestañas dentro de Contenido. Para agregar archivos a una playlist se abre la biblioteca como selector y, al terminar, se regresa al editor.

La biblioteca permite vista previa local, búsqueda, filtros, selección ordenada y varias subidas. Cada archivo conserva su resultado, bytes enviados, error, cancelación o posibilidad de reintento. Que se hayan enviado todos los bytes no significa que el servidor haya terminado de procesarlo. **Agregar subidos a una playlist** usa los éxitos en el orden seleccionado y conserva los fallidos para reintentar.

Podés arrastrar archivos o usar **Elegir archivos**, seleccionar más de 50 en una tanda y comenzar con **Subir archivos pendientes**. La cola procesa hasta tres transferencias simultáneas, sin límite de cantidad, con un máximo de 1 GB por archivo. Se puede cancelar cada archivo o todos los pendientes y reintentar los fallidos sin volver a subir los exitosos. Mantené la página abierta durante la carga; cambiar de evento o cerrar la página cancela las transferencias locales. La cola no se conserva al recargar.

Los duplicados se detectan por nombre completo dentro del evento, sin distinguir mayúsculas, tanto en la biblioteca como en la misma cola. **Omitir** conserva el existente; **Reemplazar** guarda el nuevo contenido conservando el identificador y las referencias en playlists y escenas. La decisión puede aplicarse a todos los duplicados pendientes. Un mismo contenido con otro nombre se considera un archivo distinto. Si falla el reemplazo, se conserva el archivo anterior. Las escenas preparadas con el contenido anterior deben prepararse de nuevo; el reproductor conectado verifica la versión de su caché al volver a solicitar el recurso. Un reproductor sin conexión conserva la última copia preparada.

Editar una playlist guarda cambios sin publicarlos. **Aplicar cambios** muestra los destinos e inicia la versión guardada desde el primer archivo. Los resultados se muestran por pantalla. Para promociones, aplicar guarda la política y la envía, reiniciando el contador sin reiniciar el video actual. Una promoción en curso puede terminar antes de volver al fondo.

## Limpiar los archivos de un evento

En **Contenido → Biblioteca → Liberar espacio del evento**, elegí **Limpiar archivos del evento**. El resumen muestra los archivos físicos, las copias para TV, los huérfanos dentro de la carpeta del evento y sus temporales, junto con el espacio a liberar. Escribí **ELIMINAR** para confirmar el borrado irreversible. Las nuevas conversiones guardan sus temporales por evento; los temporales de versiones anteriores solo se incluyen si su archivo de origen sigue registrado y permite identificar el evento.

La limpieza afecta solamente al evento seleccionado: conserva el evento, las pantallas vinculadas y los nombres de las playlists y escenas. Elimina los archivos del disco y de la biblioteca, quita sus entradas de las playlists y descarta preparaciones e historiales de retorno de escenas. Las escenas que usaban esos archivos necesitan contenido nuevo. Detiene y recarga las pantallas conectadas; las desconectadas reciben el estado detenido cuando vuelven a conectarse. La caché local de los navegadores no forma parte del almacenamiento del servidor.

Esperá a que terminen las subidas y conversiones antes de limpiar. Durante la operación se bloquean temporalmente las modificaciones de la API. Si los archivos cambiaron desde el resumen, hay que revisarlo otra vez. Los archivos que no puedan borrarse por permisos o bloqueos se informan como limpieza parcial y conservan sus registros para reintentar. Un archivo ya ausente del disco se puede quitar de la biblioteca sin error.

El almacenamiento local requiere una sola instancia/proceso de la API por carpeta de medios y temporales (en IIS, un worker por application pool; sin web garden). No compartir esas carpetas con otras aplicaciones ni modificarlas externamente durante la limpieza. Los enlaces simbólicos y las uniones de directorios se rechazan. No se borran binarios de la aplicación, configuración, logs ni backups.

## Despliegue y comprobaciones

Publicar frontend y API juntos. La migración `20261025222149_AddScenesAndPlaybackConfirmation` agrega escenas, intentos y campos de correlación/visibilidad. Se aplica con el mecanismo EF existente: automáticamente si `Database:ApplyMigrationsOnStartup` está habilitado, o mediante el procedimiento de migraciones del despliegue. No se requiere un servicio externo adicional; el retorno temporal usa un servicio alojado en la API y persistencia SQL.

La vista Mapa requiere también la migración `20261029123444_AddEventMap`, que agrega el croquis y su versión al evento. Los eventos existentes comienzan con un croquis vacío. Se aplica con el mismo mecanismo de migraciones, antes de usar la nueva vista.

Ver [escenas y protocolo](scenes.md), [despliegue IIS](deployment.md) y [protocolo del Player](player-protocol.md).

Las pruebas de navegador usan la API y SignalR reales con SQLite efímero. SQL Server/IIS de producción, desconexión física de una TV, codecs específicos, límites reales de almacenamiento y navegadores de TVs requieren una comprobación en el entorno del evento.
