# Kora Admin Backend

Independent NestJS backend for the Kora platform-admin application located at
`emrc-hr/apps/admin`.

This service is intentionally separate from the tenant-facingd
`emrc_saas_erc` API. Platform-administration authentication, authorization,
data access, and deployment concerns can therefore be isolated as the admin
backend grows.

## Requirements

- Node.js 20 or later
- pnpm 10.33.0

## Install

```bash
pnpm install
```

## Run

```bash
# Development with file watching
pnpm start:dev

# Production build and start
pnpm build
pnpm start:prod
```

The server uses `PORT` when provided and otherwise listens on port `3006`.

## Quality checks

```bash
pnpm format
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## Phase 0 foundation

The service is intentionally segmented into:

- `config` — validated runtime configuration
- `database` — platform database and read-only tenant database boundaries
- `platform-auth` — independent platform login and session lifecycle
- `platform-access` — platform permissions, principal and guards
- `audit` — immutable platform security events
- `health` — liveness and database-readiness endpoints

Platform sessions are opaque, random, database-backed tokens held in an
HTTP-only cookie. They do not reuse tenant identities, tenant roles, or tenant
JWTs.

## Database setup

Apply the platform-admin schema before starting the API:

```bash
pnpm prisma:migrate:deploy
```

Create the first platform owner without putting their password on the command
line or in source control:

```bash
export PLATFORM_ADMIN_EMAIL="owner@example.com"
export PLATFORM_ADMIN_NAME="Platform Owner"
export PLATFORM_ADMIN_PASSWORD="replace-with-a-long-random-password"
pnpm admin:create
unset PLATFORM_ADMIN_PASSWORD
```

`DATABASE_URL` points to the dedicated platform-admin database.
`TENANT_DATABASE_URL` will point to the existing ERP database using a dedicated
read-only PostgreSQL role. Organization-management reads must use the tenant
database boundary; platform identities and sessions must use the admin database.

## Docker deployment on the VPS

The VPS runs PostgreSQL natively, outside Docker. `docker-compose.yml` therefore
uses Linux host networking so the configured `127.0.0.1:5432` database address
continues to reach the host PostgreSQL service.

```bash
# Build the images locally
docker compose build

# Apply pending platform-admin migrations explicitly
docker compose --profile tools run --rm admin-api-migrate

# Start or update the API
docker compose up -d admin-api

# Verify it
curl http://127.0.0.1:3006/api/health/live
docker compose ps
```

CI already builds and publishes both images to GHCR on every push to `main`
(see below) — for a manual deploy, pulling those instead of rebuilding from
source is faster and is what the automated deploy job itself does:

```bash
docker login ghcr.io -u <your-github-username>   # PAT with read:packages, or make the package Public

export ADMIN_API_IMAGE=ghcr.io/<owner>/<repo>:latest
export ADMIN_API_MIGRATE_IMAGE=ghcr.io/<owner>/<repo>:migrate-latest

docker compose -f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.deploy.yml --profile tools run --rm admin-api-migrate
docker compose -f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.deploy.yml up -d admin-api
```

The API container does not publish PostgreSQL and does not contain a PostgreSQL
service. Place the production admin-frontend origin in `ADMIN_FRONTEND_URL`
before deployment. Keep port `3006` behind the VPS reverse proxy/firewall rather
than exposing it directly to the public internet.

### Exposing it on a domain (nginx + TLS)

The container only ever binds to `127.0.0.1:3006` — reaching it from the
internet needs a reverse proxy in front. Point the domain's DNS A record at
the VPS first, then:

```nginx
# /etc/nginx/sites-available/<your-subdomain>
server {
    listen 80;
    server_name <your-subdomain>;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/<your-subdomain> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your-subdomain>   # rewrites the config for HTTPS and installs the cert

curl https://<your-subdomain>/api/health/live
```

## GitHub Actions CI/CD

`.github/workflows/backend.yml` runs formatting, linting, unit tests, Prisma
generation, the Nest build, and a Docker runtime build on every pull request.
Pushes to `main` publish immutable runtime and migration images to GitHub
Container Registry (GHCR) — each as an immutable `sha-<commit>` tag plus a
floating `:latest` / `:migrate-latest` tag for manual deploys that don't want
to look up a specific commit. The production deploy job applies migrations,
starts the image, and verifies the liveness endpoint.

To enable deployment, add these repository secrets:

- `DEPLOY_HOST` — VPS hostname or IP address.
- `DEPLOY_USER` — SSH user that can run Docker Compose.
- `DEPLOY_SSH_PRIVATE_KEY` — deployment SSH private key.
- `DEPLOY_KNOWN_HOSTS` — the exact `known_hosts` entry for the VPS.
- `GHCR_PULL_TOKEN` — a GitHub fine-grained access token with **Packages: Read**
  access to this repository's container package.

Set the repository variable `DEPLOY_ENABLED` to `true` only after those secrets
are configured. Optionally set `DEPLOY_PATH` to the checked-out backend
directory on the VPS; it defaults to `/opt/emrc-admin-backend`. The VPS must
already contain `.env`, `docker-compose.yml`, and `docker-compose.vps.yml`; CI
uploads `docker-compose.deploy.yml` on each deployment. GitHub Environments can
be configured to require approval for the `production` environment before the
deploy job runs.
