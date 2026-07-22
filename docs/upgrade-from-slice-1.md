# Upgrade from Slice 1 or Slice 2

These steps preserve the existing PostgreSQL volume and application data while adding persistence integrity and tenant-aware authentication.

## 1. Stop the development servers

Press `Ctrl+C` in each terminal running `npm run dev`.

## 2. Replace the repository files

Copy the current repository files over the existing project. Keep the existing `.env` file and PostgreSQL volume.

## 3. Configure local authentication

Make sure `.env` contains:

```env
DATABASE_URL=postgres://ald:ald@127.0.0.1:65432/ald
NODE_ENV=development
WEB_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:4000
SESSION_TTL_HOURS=12
DEV_SEED_PASSWORD=
```

Set `DEV_SEED_PASSWORD` to a local password containing at least 12 characters. Do not commit `.env` or share this development password. The seed hashes it with Argon2id and never prints it.

## 4. Install and upgrade

```powershell
npm install
npm run db:migrate
npm run db:seed
```

The migration runner is idempotent. It applies the authentication migration in one transaction after the persistence migration. Existing application records remain in place.

Authentication migration behavior:

- Existing `administrator` roles become `admin`.
- Existing `approver` roles become `reviewer`.
- Existing users receive non-usable hashes before `password_hash` becomes required.
- Session and authentication-audit tables use tenant-safe composite foreign keys.
- Authentication audit records are append-only.
- Migration stops without partial changes if case-insensitive email duplicates or unsupported roles prevent the new constraints.

The development seed installs the configured local password for `maria.santos@example.test`. Other seeded users keep non-usable hashes in this slice.

## 5. Verify

```powershell
npm run typecheck
npm test
npm run build
npm run format:check
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API liveness: `http://localhost:4000/health`
- Database readiness: `http://localhost:4000/ready`

Sign in as `maria.santos@example.test` with the local password configured before seeding.

Expected readiness response:

```json
{
  "status": "ready",
  "database": "reachable"
}
```
