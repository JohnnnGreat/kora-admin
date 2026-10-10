# Admin backend conventions

NestJS + Prisma, platform-admin-only (`emrc_admin_backend`, separate from
the tenant ERP backend `emrc_saas_erc`). The email module (`src/email/`) is
the reference implementation for how a non-trivial feature here should look
— when building something new, check how that one does it before inventing
a different shape.

## Module shape

Standard Nest: `<feature>.module.ts`, `<feature>.controller.ts`,
`<feature>.service.ts`, `dto/<feature>.dto.ts`. Controller stays thin —
param/body plumbing, `@RequirePlatformPermissions`, and (for mutating
actions) an `AuditService.record()` call with a clear `action` string. All
real logic lives in the service.

- Gate every authenticated controller with
  `@RequirePlatformPermissions('platform.configure')` (or the relevant
  permission string) at the class level, same as `EmailController`.
- A route meant for a non-admin caller (a recipient, a third-party
  provider's webhook) gets its own controller with no
  `RequirePlatformPermissions`, and verifies itself independently — see
  "Security patterns" below. Never rely on the permission guard protecting
  something it was never applied to.
- Record an audit entry (`this.audit.record({...})`) for every mutating
  admin action, same pattern as `EmailController.record()`.

## Database access

Two separate databases, two separate services — never blur them:

- `PlatformDatabaseService` — this app's own Prisma-modeled tables
  (`PlatformEmail*`, `PlatformAdmin`, etc.). Normal Prisma client calls.
- `TenantDatabaseService` — a **read-only** raw-SQL connection into the
  tenant ERP's database (`read<T>(sql, values)`, enforces `SELECT`/`WITH`
  only). Used for cross-tenant visibility (e.g. resolving an email audience
  against tenant users). Never attempt to write through this service — if a
  feature needs to write into a tenant's own data, that's a sign it needs
  its own platform-side table instead (see "Billing mode" design below for
  the model this led to).
- Always check `tenant.isConfigured()` before using it and throw
  `ServiceUnavailableException` if the caller asked for something that
  needs it and it isn't configured — don't let a missing tenant connection
  silently return an empty/wrong result.

## Migrations

Written by hand in `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
(no live DB connection from a dev machine — `prisma migrate deploy` runs as
part of the CI/CD deploy, via the `admin-api-migrate` Docker target in
`backend.yml`). Keep migrations additive wherever possible (new enum value,
new nullable column, new table) so they're safe to deploy without a
coordinated backfill. Run `npx prisma generate` locally after a schema
change so typecheck reflects it — this needs no DB connection.

## Env vars

This app reads env from a real `.env` file sitting on the server
(`env_file: .env` in `docker-compose.yml`), **not** reconstructed from
GitHub Actions secrets per deploy like the tenant ERP backend is. A new env
var therefore needs two things, not one: (1) added + commented in
`.env.example` explaining what breaks without it, and (2) **said out loud to
whoever has server access** — the code change alone does nothing in
production until someone adds the real value to the server's `.env` by
hand. Don't assume it's there just because `.env.example` documents it.

## Security patterns already established — reuse these, don't reinvent

- **Signed tokens for a public action tied to an identity** (e.g. the
  unsubscribe link): HMAC-SHA256 over `<identity>.<timestamp>`, base64url
  signature, timestamp checked for a max age, compared with
  `node:crypto`'s `timingSafeEqual` — never `===` on a signature. See
  `EmailService.unsubscribeToken` / `verifyUnsubscribeToken`.
- **Verifying an inbound webhook**: needs the raw request bytes, not
  Nest's parsed body — `NestFactory.create(AppModule, { rawBody: true })`
  in `main.ts`, then `request.rawBody` in the controller. Re-serializing
  parsed JSON is not guaranteed to reproduce the signed bytes. See
  `verifyResendWebhook` / the `resend-webhook` controller method.
- If a secret needed for verification isn't configured, **log a clear
  warning and fail open only where that's genuinely acceptable for local/
  staging use** (documented, not silent) — never silently fail closed in a
  way that looks like success, and never silently fail open in a way that
  isn't logged.

## Testing

Unit-test the pure/security-critical logic directly — token sign/verify
round-trips, webhook signature verification, per-recipient render/merge
logic — by instantiating the service with lightweight manual mocks (`{} as
never` for unused dependencies, a small object literal for `ConfigService`
with `get`/`getOrThrow`), not full `Test.createTestingModule` machinery
unless the test actually needs Nest's DI. See `email.service.spec.ts`.

Before considering a change done: `npx tsc --noEmit -p .`, `npx jest`, and
`npx eslint src/<touched paths> --fix` must all be clean.
