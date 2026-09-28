# Shiftwise — shift scheduling & time clock

Work in progress; see `PROGRESS.md` for status and `Spec.md` for the specification.
Full setup instructions are written at the end of the build (Spec rule 10).

Quick start:

```bash
cp .env.example .env        # fill DATABASE_URL and TEST_DATABASE_URL
npm install
npm run db:deploy           # apply migrations
npm run db:seed             # DESTRUCTIVE: truncates and seeds the dev DB
npm run dev
```

Seed logins (password `password1234`): `admin@example.com` (platform admin), `owner@maple.example.com`,
`manager@maple.example.com`, `emma@maple.example.com`, `owner@harbour.example.com`, `sam@example.com` (two businesses).
