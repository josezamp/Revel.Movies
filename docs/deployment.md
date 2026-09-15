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
- WebSocket Protocol
- ASP.NET Core Hosting Bundle for .NET 10
- SQL Server reachable by the API process

The API connection string is read from `ConnectionStrings:RevelMovies`. The repository default is suitable for local Windows development with Integrated Security:

```text
Server=localhost;Database=Revel.Movies;Trusted_Connection=True;TrustServerCertificate=True;
```

For IIS, override the connection string using the deployment environment instead of committing production credentials to the repository.

The application currently applies pending EF Core migrations on startup when `Database:ApplyMigrationsOnStartup` is `true`.

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
- Health: `http://localhost:65179/health`

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
