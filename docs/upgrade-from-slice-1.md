# Upgrade from Slice 1

These steps preserve the existing PostgreSQL volume and application data.

## 1. Stop the development servers

Press `Ctrl+C` in the terminal running `npm run dev`.

## 2. Replace the repository files

Copy the Slice 2 repository files over the existing project. Keep the existing `.env` file.

## 3. Add the temporary server-controlled identity

Add these values to `.env`:

```env
DEV_TENANT_ID=00000000-0000-4000-8000-000000000001
DEV_REVIEWER_ID=11111111-1111-4111-8111-111111111111
```

The database URL should remain:

```env
DATABASE_URL=postgres://ald:ald@127.0.0.1:65432/ald
```

## 4. Install and upgrade

```powershell
npm install
npm run db:migrate
npm run db:seed
```

The migration command is idempotent. It records the original schema as a baseline and then applies the persistence and tenant-integrity upgrade.

## 5. Verify

```powershell
npm run typecheck
npm test
npm run build
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API liveness: `http://localhost:4000/health`
- Database readiness: `http://localhost:4000/ready`

Expected readiness response:

```json
{
  "status": "ready",
  "database": "reachable"
}
```
