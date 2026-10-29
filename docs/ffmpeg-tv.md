# Reducir tamaño para TV

En **Contenido → Biblioteca**, cada video ofrece **Reducir tamaño para TV** cuando el servidor tiene habilitada la función. El trabajo continúa aunque cierres el navegador; la tarjeta muestra la cola, el progreso y el resultado.

Se genera otro archivo con nombre terminado en **· TV** y un identificador propio. El original conserva sus bytes, URL, referencias en playlists y escenas. Abrí **Ver copia TV** para revisarlo y seleccioná esa copia al armar una playlist o enviarla a una pantalla. **Ver original** abre la vista previa del original. Las pantallas no cambian automáticamente.

El perfil genera MP4 H.264 Main, `yuv420p`, sin audio, CRF 24, hasta 30 FPS y un rectángulo de 1920×1080 (1080×1920 en vertical), sin ampliar videos más pequeños. Respeta la rotación del archivo, las proporciones de visualización y las tasas inferiores, incluidas las fraccionarias. Usa `faststart` y limita el bitrate de video a 5 Mbit/s. Los videos HDR se rechazan con un mensaje para exportarlos previamente en SDR.

La copia solo se agrega si pasa la validación de formato, duración y perfil y **pesa menos que el original**. Si no hay ahorro, se descarta el resultado temporal y se informa en la tarjeta. El porcentaje mostrado es el ahorro real de bytes. Conservar ambos archivos aumenta el almacenamiento total del servidor; el ahorro corresponde al video que descargarán las TVs. La subida inicial conserva su tamaño original.

## Instalar en Windows Server / IIS

En el servidor actual, **RevelMovies** es el sitio y **api** es una aplicación IIS dentro del sitio. La API y sus archivos de configuración están en `C:\Sites\RevelMovies\api`. Con `MediaStorage:RootPath=media`, los archivos se guardan en `C:\Sites\RevelMovies\api\media`; las copias TV se guardan en ese mismo almacenamiento. Podés conservar esta ubicación.

En IIS, seleccioná **RevelMovies → api → Configuración avanzada…** para consultar el **Application Pool** asignado a la aplicación. Ese es el pool cuya identidad necesita permisos y que hay que reciclar; su nombre no se deduce del alias `api` ni del nombre del sitio. Si usa una cuenta personalizada, otorgá los permisos a esa cuenta en lugar de `IIS AppPool\<nombre>`.

1. Descargá una compilación estable de Windows de los proveedores enlazados por [FFmpeg](https://ffmpeg.org/download.html#build-windows), por ejemplo Gyan. Usá una compilación con el encoder `libx264`. La integración usa **xFFmpeg.NET 7.4.0** y se prueba con FFmpeg/FFprobe **9.0.2**; el paquete NuGet no instala los ejecutables.
2. Extraé el paquete en una carpeta permanente, dejando estos ejecutables:

   ```text
   C:\Tools\ffmpeg\bin\ffmpeg.exe
   C:\Tools\ffmpeg\bin\ffprobe.exe
   ```

3. En PowerShell verificá ambos ejecutables y el encoder:

   ```powershell
   & 'C:\Tools\ffmpeg\bin\ffmpeg.exe' -version
   & 'C:\Tools\ffmpeg\bin\ffprobe.exe' -version
   & 'C:\Tools\ffmpeg\bin\ffmpeg.exe' -hide_banner -encoders | Select-String libx264
   ```

4. Creá una carpeta de trabajo fuera del directorio público del sitio. En PowerShell como administrador, reemplazá `RevelMoviesApi` por el nombre real del Application Pool de **api**:

   ```powershell
   New-Item -ItemType Directory -Force -Path 'C:\RevelMoviesData\transcoding'
   icacls 'C:\Tools\ffmpeg' /grant 'IIS AppPool\RevelMoviesApi:(OI)(CI)RX'
   icacls 'C:\RevelMoviesData\transcoding' /grant 'IIS AppPool\RevelMoviesApi:(OI)(CI)M'
   icacls 'C:\Sites\RevelMovies\api\media' /grant 'IIS AppPool\RevelMoviesApi:(OI)(CI)M'
   ```

5. En `C:\Sites\RevelMovies\api\appsettings.json`, combiná estas secciones con la configuración existente. Conservá las demás claves y reemplazá la sección `TvOptimization` existente para no duplicarla. Si hay un `appsettings.Production.json` o variables de entorno que sobrescriben estos valores, actualizá esa configuración también:

   ```json
   {
     "MediaStorage": {
       "RootPath": "C:\\Sites\\RevelMovies\\api\\media",
       "MaxUploadBytes": 1073741824
     },
     "TvOptimization": {
       "Enabled": true,
       "FFmpegPath": "C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe",
       "FFprobePath": "C:\\Tools\\ffmpeg\\bin\\ffprobe.exe",
       "WorkPath": "C:\\RevelMoviesData\\transcoding",
       "TimeoutMinutes": 30,
       "Threads": 2
     }
   }
   ```

   También podés configurar variables de entorno del proceso IIS: `TvOptimization__Enabled`, `TvOptimization__FFmpegPath`, `TvOptimization__FFprobePath`, `TvOptimization__WorkPath`, `TvOptimization__TimeoutMinutes` y `TvOptimization__Threads`. Usá rutas absolutas: el PATH del usuario interactivo puede ser distinto al del Application Pool. La función está deshabilitada por defecto; activar `Enabled` requiere que ambos ejecutables existan. Los permisos y codecs se comprueban ejecutando una conversión.

6. Publicá **API y frontend** siguiendo [deployment.md](deployment.md). Conservá `C:\Sites\RevelMovies\api\media` al publicar: contiene los archivos cargados y no debe eliminarse al limpiar el destino. Conservá también la configuración del servidor. Esta versión incluye la migración **AddMediaOptimizationJobs**. Si `Database:ApplyMigrationsOnStartup=true`, la API la aplica al arrancar. Si administrás las migraciones por separado, generá y aplicá el script SQL con tu procedimiento habitual antes de iniciar esta versión.
7. Reciclá el Application Pool de **api** para que tome la configuración. Para trabajos continuos, usá un solo proceso del pool (`Maximum Worker Processes=1`), `Start Mode=AlwaysRunning`, `Idle Time-out=0` y **Preload Enabled=True en la aplicación api**, con Application Initialization instalado. IIS configura el [preload por aplicación](https://learn.microsoft.com/en-us/iis/configuration/system.applicationhost/sites/site/application/). La cola se ejecuta mientras la API está activa; no es un servicio Windows independiente.
8. Subí un MP4 con audio y 60 FPS, pulsá **Reducir tamaño para TV** y verificá la copia: tamaño menor, sin audio, duración completa, orientación correcta y reproducción en la TV real. El original debe seguir disponible. La compatibilidad final depende del modelo y navegador de cada TV.

## Operación y recuperación

### Si instalaste FFmpeg Essentials con WinGet

`winget install --id Gyan.FFmpeg.Essentials --exact` instala una edición que incluye `ffmpeg`, `ffprobe` y `libx264`, según la [lista de bibliotecas de Gyan](https://www.gyan.dev/ffmpeg/builds/#libraries). La versión 9.0.1 informada por WinGet no está bloqueada por la aplicación; las pruebas locales se ejecutaron con 9.0.2.

Abrí una nueva consola con el usuario que hizo la instalación para tomar el PATH actualizado:

```powershell
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders | Select-String libx264
(Get-Command ffmpeg.exe).Source
(Get-Command ffprobe.exe).Source
```

Que funcionen en la consola de `La Matilde` no confirma que el Application Pool pueda encontrarlos o ejecutarlos. Para mantener las rutas de configuración indicadas arriba, copiá los dos ejecutables a `C:\Tools\ffmpeg\bin`. En una consola elevada del mismo usuario, este bloque localiza la instalación por usuario de Essentials; si no encuentra un único paquete, se detiene para que elijas la ubicación correcta:

```powershell
$ffmpegPackageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$ffmpegCandidates = @(Get-ChildItem -LiteralPath $ffmpegPackageRoot -Directory -Filter 'Gyan.FFmpeg.Essentials_*' -ErrorAction Stop |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter 'ffmpeg.exe' -Recurse })
if ($ffmpegCandidates.Count -ne 1) {
    throw 'No se encontró una única instalación de Essentials. Revisá las rutas mostradas por Get-Command y la ubicación del paquete.'
}
$ffmpegSourceBin = $ffmpegCandidates[0].Directory.FullName
if (-not (Test-Path -LiteralPath (Join-Path $ffmpegSourceBin 'ffprobe.exe') -PathType Leaf)) {
    throw 'No se encontró ffprobe.exe junto a ffmpeg.exe.'
}
New-Item -ItemType Directory -Force -Path 'C:\Tools\ffmpeg\bin' | Out-Null
Copy-Item -LiteralPath (Join-Path $ffmpegSourceBin 'ffmpeg.exe'), (Join-Path $ffmpegSourceBin 'ffprobe.exe') -Destination 'C:\Tools\ffmpeg\bin' -Force
```

Luego seguí los pasos 3 a 8 de instalación: verificá los ejecutables copiados, asigná permisos al pool de `api`, configurá `C:\Sites\RevelMovies\api\appsettings.json` y reciclá ese pool. La carpeta `C:\Sites\RevelMovies\front` no interviene en la configuración de FFmpeg. Cuando actualices FFmpeg con WinGet, actualizá también estas copias con la cola inactiva.

### Cola y resultados

- Una conversión simultánea por proceso de API, con dos hilos por defecto para decodificación/codificación. El límite de tiempo abarca copia, análisis, conversión y publicación; se puede configurar entre 1 y 180 minutos.
- Cola y resultados persistidos en SQL. Repetir una solicitud activa devuelve el mismo trabajo; una copia existente se reutiliza. Si eliminaste la copia, podés volver a generarla.
- Un cierre ordenado cancela FFmpeg, limpia temporales y deja el trabajo en cola. Después de una caída abrupta, un trabajo se puede reclamar al vencer su reserva: como máximo `TimeoutMinutes + 2` minutos desde que comenzó. No se publica una copia si el original fue reemplazado o eliminado durante la conversión.
- Los temporales normales se limpian al terminar. Una caída del proceso puede dejar carpetas en `WorkPath`; con la API detenida se pueden eliminar esas carpetas temporales. No borres la carpeta de medios originales. Dejá espacio para el original, una copia temporal de entrada, la salida temporal y la copia final durante la publicación.
- Si falla una conversión, la tarjeta ofrece reintentar y el original permanece disponible. Los detalles técnicos se registran en los logs de la API. Si el botón está deshabilitado, revisá `Enabled`, las rutas y los permisos. Si FFmpeg no contiene `libx264`, la conversión fallará con el original intacto.
- La implementación utiliza xFFmpeg.NET para convertir y FFprobe JSON para validar. Captura explícitamente el evento `Error` de xFFmpeg.NET: completar el `await` por sí solo no confirma el éxito.

## Desarrollo y Docker

En desarrollo podés usar `ffmpeg` y `ffprobe` en PATH con `TvOptimization__Enabled=true`. Para Docker, instalá ambos ejecutables en la imagen de la API y configurá las rutas Linux y una carpeta de trabajo escribible; la imagen base del repositorio no los incluye y conserva la función deshabilitada.

Las pruebas de API usan una base SQLite temporal para comprobar cola, preservación del original, errores, reemplazos y recuperación. Las pruebas `FFmpegTvVideoOptimizerTests` usan los ejecutables reales en PATH, o las rutas de `REVEL_TEST_FFMPEG` y `REVEL_TEST_FFPROBE`. Si no están disponibles, esas pruebas se informan como omitidas.

```powershell
dotnet test apps/api/RevelMovies.Api.Tests/RevelMovies.Api.Tests.csproj
npm --prefix apps/web run build
npm --prefix apps/web test
$env:TvOptimization__Enabled = 'true'
npm --prefix apps/web run test:browser -- tests/browser/tvOptimization.spec.ts
```
