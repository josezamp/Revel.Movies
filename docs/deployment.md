# Deployment

## Local development

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

```bash
docker compose up --build
```

Then open:

- `http://localhost:8080/admin`
- `http://localhost:8080/player`

For a LAN event, expose the host IP to the TVs, for example `http://192.168.1.10:8080/player`.
