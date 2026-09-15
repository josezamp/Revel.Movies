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
│   └── RevelMovies
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
Server=localhost;Database=RevelMovies;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true
```

For IIS, override the connection string using the deployment environment instead of committing production credentials to the repository.

The application currently applies pending EF Core migrations on startup when `Database:ApplyMigrationsOnStartup` is `true`.

## Local development

A local SQL Server instance can be used directly with the default connection string.

API:

```bash
cd apps/api
dotnet run --project RevelMovies.Api --urls http://localhost:5080
```

Web:

```bash
cd apps/web
npm install
npm run dev
```

Open:

- Admin: `http://localhost:5173/admin`
- Player: `http://localhost:5173/player`
- Health: `http://localhost:5080/health`

## Docker Compose

Docker remains available as an optional local or portable deployment path. The compose stack uses SQL Server 2022.

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
