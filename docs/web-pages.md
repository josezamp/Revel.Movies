# Proyectar páginas web

En **Admin → Proyectar una web**, ingresá una URL HTTP(S), elegí una pantalla vinculada o un grupo y presioná **Mostrar página**. **Retirar página** vuelve a mostrar la multimedia que continúa reproduciéndose debajo. Un envío nuevo reemplaza la URL anterior. Los anuncios aparecen por encima de la página.

Se reutilizan el pairing, la identidad de la TV, los grupos y SignalR existentes. La URL se guarda en SQL y se recupera al reconectarse o recargar el player. No hace falta vincular Revel con el servicio que publica la página: no hay credenciales compartidas, llamadas entre APIs, SDK del concurso ni acceso a su base de datos. Cada servicio se despliega y puede funcionar por separado.

La página recibe el tamaño y la rotación configurados para la TV. Blackout la oculta sin desmontarla; **Salir de blackout** en la tarjeta de la pantalla vuelve a mostrarla y detiene la multimedia de fondo. Al elegir un video, imagen o playlist y pulsar **Reproducir**, se retira automáticamente la página web y se muestra el contenido elegido. Ese cambio se conserva al recargar o reconectar la TV. Pausar, reanudar o detener la multimedia de fondo mantiene la página; **Retirar página** permite quitarla sin elegir contenido nuevo. Los tiempos internos de una web dependen de esa web: enviar a un grupo no sincroniza sus animaciones cuadro por cuadro.

## Concurso de disfraces

Usá la URL pública del concurso, por ejemplo `https://tu-evento.com/halloween/2026/concurso/live`. Muro, podio, premios y cambios de modo siguen controlándose desde Halloween. Revel solo decide en qué pantallas se ve esa página.

En el frontend de Halloween, configurá `CONTEST_FRAME_ANCESTORS` con el **origen donde se abre el player de Revel** (protocolo, dominio y puerto, sin `/player`). Puede contener varios orígenes separados por espacios o comas. El build genera `dist/web.config` para IIS con el permiso limitado a la ruta pública `live`; el resto de las rutas conserva `frame-ancestors 'self'`. Sin configurar el valor no se habilita ningún origen externo. En otros servidores hay que trasladar esa regla a sus headers HTTP.

Ejemplo local, en PowerShell desde el frontend de Halloween:

```powershell
$env:CONTEST_FRAME_ANCESTORS = 'http://localhost:5173'
npm run dev:demo
```

En Revel, proyectá `http://localhost:5190/halloween/2026/concurso/live`. `localhost` sirve cuando ambos navegadores corren en la misma PC. Para TVs usá los nombres o IPs accesibles desde esas TVs, tanto en la URL del concurso como en el origen permitido de Revel.

## Condiciones del navegador

- La URL debe abrirse en la TV y el sitio debe permitir ese origen de Revel mediante `Content-Security-Policy: frame-ancestors`. Un `X-Frame-Options` restrictivo o una política adicional del proxy puede bloquearlo. [Referencia de CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
- Si el player usa HTTPS, la página también debe usar HTTPS. Debe tener un origen distinto al de Revel. El administrador valida su propio origen y el player valida el suyo al aplicar la URL.
- El iframe permite scripts y el origen del sitio para sus APIs; no concede navegación de la ventana principal, popups, formularios, cámara, micrófono ni geolocalización. No se añaden tokens de Revel a la URL y no se envía Referer.
- Usá páginas públicas de confianza, preparadas para exhibición. No se soportan pantallas que necesiten un inicio de sesión interactivo; las cookies de terceros pueden estar bloqueadas. Una web con scroll seguirá teniendo su propio scroll: Revel no modifica su diseño.
- Un envío aceptado significa que la asignación quedó guardada, y el acuse `executed` significa que el iframe fue asignado. El navegador no permite confirmar de forma fiable que una web de otro origen haya cargado o haya sido bloqueada. Si se ve en blanco, verificá la URL desde la TV y sus headers. [Comportamiento de iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior).

## Protocolo y despliegue

Se usa `POST /api/displays/{id}/commands` o `POST /api/display-groups/{id}/commands`:

```json
{ "type": "webpage.show", "payload": { "url": "https://tu-evento.com/halloween/2026/concurso/live" } }
```

Para retirar: `{ "type": "webpage.clear" }`. El servidor normaliza y valida la URL; nunca descarga ni hace proxy de su contenido.

Publicá API y frontend de Revel juntos y aplicá la migración **20261017120000_AddWebPages** por el mecanismo habitual de despliegue. Agrega una columna nullable `web_page_json` en `display_playback_states`; no cambia los registros de pairing. Las pantallas abiertas necesitan recargar el player actualizado una vez. No se aplicaron migraciones a bases reales durante el desarrollo de esta función.

## Verificación local

```powershell
dotnet test apps/api/RevelMovies.Api.Tests
cd apps/web
npm test
npm run build
npm run test:browser
```

Las pruebas de navegador requieren Chromium de Playwright (`npx playwright install chromium`). Arrancan la API real con SQLite temporal en memoria en el puerto 65180, Vite en 5175 y una página de prueba independiente en 5176; no usan la base de desarrollo. Cubren pairing real, comandos por SignalR, grupos, reemplazo, recarga, rotación, blackout, anuncios y retiro estando desconectado. Para apuntar Vite a otra API local, se puede configurar `VITE_API_PROXY_TARGET` (por defecto `http://localhost:65179`).
