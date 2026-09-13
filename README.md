# SGA CMS Hub — bph-cms

CMS pusat untuk Badan Pengurus Harian (BPH) SGA Cakrawala. Mengelola event, form
(Student Voice), penilaian QPR, akun divisi, dan handoff SSO ke dashboard divisi lain.

Live: **https://cms.sga-cakrawala.org**

## Stack

- **Runtime**: Cloudflare Workers (Hono)
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM — migrasi di `drizzle/`
- **Storage**: Cloudflare R2 (`bph-cms-media`) — cover event + lampiran form
- **Auth**: service binding `AUTH_SERVICE` ke `sga-superapp-auth` (Bearer token,
  cookie tidak diterima)
- **Panel**: React 18 + Vite, hash routing, diserve sebagai aset statis Worker
  (`panel/`)

## Struktur

```
src/
  index.ts            # app Hono, CORS, security headers, proxy auth, rate limit
  middlewares/        # admin-auth (session via binding), require-permission (RBAC), rate-limiter
  modules/
    events/           # CRUD event + sesi (admin & publik)
    forms/            # Student Voice Studio: campaign form + respons + analytics
    qpr/              # penilaian QPR v2 (publik tanpa login, rekap BPH)
    accounts/         # divisi & membership (platform_admin)
    media/            # upload cover ke R2
    handoff/          # SSO antar dashboard via one-time code
    me/               # profil, membership, workspace options
    audit/            # audit log
  shared/             # ApiResponse/ApiError wrapper, permissions (RBAC)
  db/                 # schema Drizzle + koneksi + rate limit D1
  test/               # harness Miniflare (h.req path/method/token/json)
panel/                # SPA admin (React + Vite)
drizzle/              # migrasi SQL
docs/                 # panduan teknis (API, running guide, panel UI)
```

## Perintah

```bash
npm install
npm run dev           # worker lokal (wrangler dev) — panel: npm run dev di panel/
npm test              # suite integrasi via Miniflare (forms/qpr/handoff/security)
npm run deploy        # build panel + deploy worker (dari root)
npx wrangler d1 migrations apply DB --remote   # apply migrasi
```

## Konfigurasi

Var + binding ada di `wrangler.jsonc`. Secret via `wrangler secret put`:

| Secret | Fungsi |
|---|---|
| `HANDOFF_SHARED_SECRET` | shared secret SSO handoff dengan dashboard tujuan (wajib; tanpa ini exchange fail-closed 503) |

Var penting: `CORS_ORIGIN` (allowlist), `DOCS_ALLOW_EMAILS` (akses Swagger),
`ALLOW_DEV_AUTH` (hanya berlaku di localhost), `PLATFORM_BOOTSTRAP_EMAILS`.

## Keamanan (ringkas)

- Bearer-only auth via service binding; tanpa cookie = tanpa CSRF.
- Rate limit D1 di semua endpoint sensitif: sign-in 20/15m per IP+email dan 60/15m per
  IP; form publik 30/mnt; QPR submit 10/mnt.
- RBAC per-resource: admin divisi hanya bisa sentuh event/form/divisinya sendiri.
- Upload: allowlist ekstensi + batas ukuran; Content-Type diturunkan dari ekstensi
  (bukan dari klaim klien).
- Audit log untuk semua mutasi admin.
- Security headers: nosniff, DENY iframe, CSP `default-src 'none'`.

## Dokumentasi

- `docs/API.md` + `/docs/` di production — API docs (Swagger, akun allowlist)
- `docs/RUNNING-GUIDE.md` — cara menjalankan
- `docs/PANEL-UI.md` — UI panel
- `docs/FE-INTEGRATION.md`, `docs/ACCOUNTS-ACCESS.md`, `docs/DIVISION-ACCOUNTS.md` — integrasi & akses
