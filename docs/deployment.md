# Deployment

## Primary production target: Windows Server + IIS + SQL Server

Revel Movies is intended to run primarily on a Windows Server with IIS and SQL Server.

Recommended layout:

```text
Windows Server
├── IIS
│   ├── Revel Movies Web
│   └── Revel Movies API / SignalR
├── SQL Server
│   └── Revel.Movies
└── Media storage
    └── D:\RevelMovies\media
```

Required Windows features/components:

- IIS
- IIS URL Rewrite module (for the React application's browser routes)
- WebSocket Protocol
- ASP.NET Core Hosting Bundle for .NET 10
- SQL Server reachable by the API process

The API connection string is read from `ConnectionStrings:RevelMovies`. The repository default is suitable for local Windows development with Integrated Security:

```text
Server=localhost;Database=Revel.Movies;Trusted_Connection=True;TrustServerCertificate=True;
```

For IIS, override the connection string using the deployment environment instead of committing production credentials to the repository.

The application currently applies pending EF Core migrations on startup when `Database:ApplyMigrationsOnStartup` is `true`.

## IIS: frontend at the site root and API at `/api`

Build both applications from the repository root:

```powershell
dotnet publish apps/api/RevelMovies.Api/RevelMovies.Api.csproj -c Release
npm --prefix apps/web ci
npm --prefix apps/web run build
```

Deploy the contents of these folders:

| Build output | IIS destination |
| --- | --- |
| `apps/web/dist` | Physical path of the root website |
| `apps/api/RevelMovies.Api/bin/Release/net10.0/publish` | Physical path of the child application with alias `api` |

The frontend output includes `index.html`, `assets`, `sw.js`, and `web.config`. Copy its `web.config` to the website root. It sets `index.html` as the default document and rewrites browser routes such as `/admin` and `/player` to it, while excluding `/api`, existing files, and existing directories. Its settings are not inherited by child applications. The IIS URL Rewrite module must be installed for this configuration to load.

The backend must be an IIS **application**, with its own application pool set to **No Managed Code**. Deploy the backend's published `web.config` alongside its binaries; it is based on the checked-in API configuration and includes the upload limit. It is separate from the frontend's `web.config`.

IIS supplies `/api` as the backend's `PathBase`, so backend endpoint patterns are relative to it (`/events`, `/media`, etc.). When running directly on Kestrel, `UsePathBase("/api")` extracts the same prefix before routing. Public REST URLs therefore remain `/api/events`, `/api/media/{id}/content`, and so on in IIS, development, and Docker. SignalR uses `/api/hubs/player`; both the Vite and nginx proxies support WebSocket upgrades on `/api`.

After publishing **both** applications, check:

- `/admin` and `/player`: the React application loads, including on refresh.
- `/api/health`: returns `Healthy`.
- `/api/events`: returns `401` without an admin session, and a JSON array after login.
- `/api/hubs/player/negotiate?negotiateVersion=1`: a POST returns SignalR negotiation JSON.

The health endpoint only checks whether the API is running; `/api/events` also exercises the database connection. Do not use `/api/api/events`.

Routing regression checks (including simulated IIS `PathBase` handling) can be run without SQL Server:

```powershell
dotnet test apps/api/RevelMovies.Api.Tests/RevelMovies.Api.Tests.csproj
```

## Scheduled playback

For scene schedules to run with the admin panel closed, keep the API running independently of HTTP traffic. Use one API instance/process. In IIS, configure the API's pool with `Maximum Worker Processes=1`, `Start Mode=AlwaysRunning` and `Idle Time-out=0`; enable **Preload Enabled=True on the api application**, with Application Initialization installed. Apply `20261029132437_AddSceneSchedules` before using the new panel. See [scheduling and restart behavior](scheduling.md).

## Media storage

Para habilitar **Reducir tamaño para TV**, ver [instalación de FFmpeg y configuración de IIS](ffmpeg-tv.md). Incluye rutas, permisos, migración y recuperación de la cola.

The default storage root is the relative `media` directory under the API content root. In the current IIS layout, `api` is a child application at `C:\Sites\RevelMovies\api`, so `media` resolves to `C:\Sites\RevelMovies\api\media`. This location can be retained; preserve it when publishing or cleaning the API directory. To make the current location explicit:

```text
MediaStorage__RootPath=C:\Sites\RevelMovies\api\media
MediaStorage__MaxUploadBytes=1073741824
```

The identity of the Application Pool assigned to the **api application** must have read/write/delete permission on that directory. Check the application's Advanced Settings to find its pool; it may differ from the root site's pool. A dedicated data directory outside the publication folder is also supported, but changing the configured root does not move existing files.

Revel Movies accepts files up to 1 GiB (1,073,741,824 bytes) by default. Kestrel and the in-process ASP.NET Core IIS server allow an additional 1 MiB for multipart boundaries, headers and form fields. The per-file limit remains `MediaStorage:MaxUploadBytes`.

IIS request filtering also has its own limit. The API's checked-in `web.config` includes the matching request limit and is preserved by `dotnet publish`:

```xml
<system.webServer>
  <security>
    <requestFiltering>
      <requestLimits maxAllowedContentLength="1074790400" />
    </requestFiltering>
  </security>
</system.webServer>
```

If you change `MediaStorage:MaxUploadBytes`, update `maxAllowedContentLength` in the API application's `web.config` to that value plus 1,048,576 bytes. For Docker, update `client_max_body_size` in `docker/nginx.conf` to match (the default is `1025m`) and rebuild the web container.

A `413 Request Entity Too Large` from IIS can indicate that the in-process server still has its default 30,000,000-byte request limit. Raising only Kestrel's limit does not affect IIS in-process hosting. Deploy both the updated API binaries and its `web.config`; changing the frontend's configuration alone is insufficient. See [ASP.NET Core upload limits](https://learn.microsoft.com/aspnet/core/mvc/models/file-uploads#iis).

## Local development

A local SQL Server instance can be used directly with the default connection string.

Configure the administrator credentials as described below before opening the panel.

API:

```bash
cd apps/api
dotnet run --project RevelMovies.Api
```

The checked-in launch profile exposes HTTP on `http://localhost:65179` and the Vite development proxy targets that address.

Web:

```bash
cd apps/web
npm install
npm run dev
```

Open:

- Admin: `http://localhost:5173/admin`
- Player: `http://localhost:5173/player`
- Health: `http://localhost:65179/api/health`

## Samsung Tizen video orientation

Some Samsung TV browsers resize the native video plane without applying the page's CSS rotation. For Tizen Smart TV user agents, the player uses a canvas when a video is oriented at 90°, 180° or 270°. Images and overlays continue to rotate with the viewport; 0° and desktop playback use the native video element.

The same video element retains playback, pause, seek, loop and playlist state. Frame copies are capped at 30 fps and a longest edge of 1920 pixels to limit TV rendering cost. Changing media, returning to 0°, or enabling blackout disposes the frame loop. If the browser rejects copying video frames, the player keeps the native video visible and displays an orientation error.

Publish the frontend and reload the TV's Player page to load this change. Validate with the actual TV model: desktop browser tests do not reproduce Tizen's hardware video plane, frame-copy restrictions or performance. Check 0°/90°/180°/270°, pause/resume, playlist transitions, announcements and blackout.

## Docker Compose

Docker remains available as an optional local or portable deployment path. The compose stack uses SQL Server 2022 and a persistent media volume.

Create an untracked `.env` with `ADMIN_USERNAME=admin` and `ADMIN_PASSWORD` set to a unique password of 12–256 characters. Compose requires the password before starting.

```bash
docker compose up --build
```

Optionally set a custom development SA password before starting the stack:

```bash
MSSQL_SA_PASSWORD="your-strong-password" docker compose up --build
```

Then open:

- `http://localhost:8080/admin`
- `http://localhost:8080/player`

For a LAN event, expose the host IP to the TVs, for example `http://192.168.1.10:8080/player`.

## Administrator login

`/admin` requires one configured administrator account. Set these values **on the API server**, using environment variables or deployment configuration outside the repository:

```text
AdminAuth__Username=admin
AdminAuth__Password=<unique password of 12–256 characters>
```

The username is case sensitive (up to 100 characters). There is no default password. Missing, blank or short credentials leave the panel locked; health checks and paired TVs remain available. The login page reports that server setup is required. Credentials never belong in `VITE_*` variables or frontend files.

For local development, the API has a `UserSecretsId`. Store credentials outside the checkout:

```powershell
dotnet user-secrets set 'AdminAuth:Username' 'admin' --project apps/api/RevelMovies.Api
dotnet user-secrets set 'AdminAuth:Password' '<your unique password>' --project apps/api/RevelMovies.Api
```

For IIS, set the two environment variables on the **API application pool**, then recycle it. Keep that server configuration when publishing. Publish both the API and frontend together. Restart the API after changing credentials; restarting invalidates existing admin sessions, so operators must log in again. TVs use their existing device tokens.

The session uses an HttpOnly, SameSite=Strict cookie scoped to `/api`, expires after 7 days without automatic renewal, and can be closed from **Cerrar sesión**. Login permits 10 requests per minute per source IP. Behind a proxy, clients may share that limit. Admin writes require the `X-Revel-Admin: 1` header in addition to the session cookie, including multipart uploads. New API routes require admin authentication by default; only health, login/session, the player protocol and GET/HEAD media content explicitly allow anonymous access. Media URLs remain available to TVs and are not private file storage.

Use HTTPS on the site to encrypt credentials and set the session cookie's Secure flag. HTTP remains supported for local event networks. If HTTPS terminates at a reverse proxy, configure trusted forwarding so ASP.NET Core sees the original HTTPS scheme. See [ASP.NET Core cookie authentication](https://learn.microsoft.com/aspnet/core/security/authentication/cookie?view=aspnetcore-10.0).

After deployment, verify that `/admin` asks for credentials, invalid credentials are rejected, login permits administration, and **Cerrar sesión** blocks access again. Check `/player` from a separate browser without an admin session and confirm playback and reconnection.
