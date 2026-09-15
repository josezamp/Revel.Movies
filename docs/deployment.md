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

The backend must be an IIS **application**, with its own application pool set to **No Managed Code**. Keep the backend's generated `web.config` in the API publish directory; it is separate from the frontend's `web.config`.

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

Revel Movies accepts files up to 1 GB by default, but IIS request filtering has its own upload limit. Configure `maxAllowedContentLength` to the same value (bytes) in the deployed site's `web.config` or IIS Request Filtering settings:

```xml
<system.webServer>
  <security>
    <requestFiltering>
      <requestLimits maxAllowedContentLength="1073741824" />
    </requestFiltering>
  </security>
</system.webServer>
```

Keep that value aligned with `MediaStorage:MaxUploadBytes`.

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
