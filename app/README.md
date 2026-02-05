# Shop Billing (Next.js + Postgres)

## Run
```bash
cp .env.example .env
docker compose up -d --build

# Initialize DB (first time only):
docker compose exec -T db psql -U app -d app < db/migrations/0001_init.sql
docker compose exec -T db psql -U app -d app < db/migrations/0002_seed.sql
docker compose exec -T db psql -U app -d app < db/migrations/0006_ready_ui_schema.sql
