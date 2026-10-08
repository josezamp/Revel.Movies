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
- `/api/events`: returns a JSON array.
- `/api/hubs/player/negotiate?negotiateVersion=1`: a POST returns SignalR negotiation JSON.

The health endpoint only checks whether the API is running; `/api/events` also exercises the database connection. Do not use `/api/api/events`.

Routing regression checks (including simulated IIS `PathBase` handling) can be run without SQL Server:

```powershell
dotnet test apps/api/RevelMovies.Api.Tests/RevelMovies.Api.Tests.csproj
```

## Media storage

The default development storage root is the relative `media` directory under the API content root. In IIS, use a dedicated persistent path, for example:

```text
MediaStorage__RootPath=D:\RevelMovies\media
MediaStorage__MaxUploadBytes=1073741824
```

The IIS Application Pool identity must have read/write/delete permission on that directory.

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
