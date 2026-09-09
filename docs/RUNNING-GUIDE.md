# Running Guide — SGA CMS Hub / BPH CMS

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Scope:** Cara setup, run, test, build, deploy, dan memahami dokumen utama project

---

## 1. Baca Dokumen Ini Dulu

Urutan baca untuk developer baru:

1. [CONTEXT.md](./CONTEXT.md)
2. [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md)
3. [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md)
4. [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md)
5. [PRD.md](./PRD.md)
6. [SDD.md](./SDD.md)
7. [API.md](./API.md)
8. [PANEL-UI.md](./PANEL-UI.md)

Ringkasnya:

- `PRD-SGA-CMS-HUB.md`: arah produk multi-divisi.
- `SDD-SGA-CMS-HUB.md`: desain teknis multi-divisi.
- `DIVISION-ACCOUNTS.md`: daftar akun/divisi dan akses.
- `PRD.md` + `SDD.md`: modul Student Event yang sudah berjalan.
- `API.md`: kontrak endpoint saat ini.

---

## 2. Struktur Project

```text
bph-cms/
  src/                 Backend Cloudflare Worker + Hono
  src/modules/events/  Modul Student Event
  src/modules/media/   Upload cover ke R2
  src/db/              Drizzle schema + D1 connection
  drizzle/             Migration D1
  panel/               React admin panel
  docs/                PRD, SDD, API, running guide
```

---

## 3. Prasyarat

Butuh:

- Node.js modern
- npm
- akun Cloudflare yang punya akses Worker, D1, R2
- Wrangler login
- auth service `sga-superapp-auth` aktif atau bisa diakses sebagai service binding

Cek versi:

```bash
node --version
npm --version
npx wrangler --version
```

Login Cloudflare:

```bash
npx wrangler login
npx wrangler whoami
```

---

## 4. Install Dependency

Root backend:

```bash
npm install
```

Panel:

```bash
npm --prefix panel install
```

Catatan: script root `npm run build` juga otomatis install panel sebelum build.

---

## 5. Environment & Binding

Konfigurasi utama ada di:

```text
wrangler.jsonc
```

Binding yang dipakai:

| Binding | Fungsi |
|---|---|
| `DB` | Cloudflare D1 database |
| `BUCKET` | R2 bucket untuk media |
| `AUTH_SERVICE` | service auth superapp |
| `RATE_LIMITER` | public event rate limit |
| `ASSETS` | static asset panel |
| `API_BASE_URL` | base URL API |
| `CORS_ORIGIN` | whitelist origin |
| `DOCS_ALLOW_EMAILS` | email yang boleh buka docs protected |
| `ALLOW_DEV_AUTH` | opsional, set `true` hanya di local dev untuk menerima token `dev-token` |

Kalau `npm run dev` gagal dengan pesan remote session could not be authenticated, jalankan:

```bash
npx wrangler whoami
npx wrangler login
```

Kalau `AUTH_SERVICE` tampil `[not connected]` di local dev, endpoint admin/login bisa gagal. Endpoint publik dan build tetap bisa dites, tetapi login admin perlu auth service lokal/remote yang benar.

Untuk local dev sementara, `ALLOW_DEV_AUTH=true` dapat dipakai agar token `dev-token`
diterima sebagai BPH bootstrap. Jangan aktifkan var ini di production.

---

## 6. Database

Generate migration dari schema Drizzle:

```bash
npm run db:generate
```

Apply migration lokal:

```bash
npm run db:migrate:local
```

Apply migration remote:

```bash
npm run db:migrate:remote
```

Untuk arah multi-divisi, migration baru harus mengikuti [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md):

- `divisions`
- `cms_memberships`
- `workspace_options`
- `audit_logs`
- kolom ownership di `events`

---

## 7. Run Development

Run Worker + assets:

```bash
npm run dev
```

Default:

```text
http://localhost:8791
```

API:

```text
http://localhost:8791/api/v1
```

Panel:

```text
http://localhost:8791
```

Docs:

```text
http://localhost:8791/docs/
```

OpenAPI:

```text
http://localhost:8791/api/v1/openapi
```

Catatan: `/api/v1/openapi` dilindungi Bearer token dan email allowlist.

---

## 8. Run Panel Saja

Kalau ingin kerja di React panel:

```bash
npm --prefix panel run dev
```

Default Vite:

```text
http://localhost:5173
```

Vite proxy mengarah ke Worker:

```text
/api/v1 -> http://localhost:8791
```

Jadi biasanya jalankan dua terminal:

```bash
npm run dev
npm --prefix panel run dev
```

---

## 9. Test & Check

Unit/self-check status event:

```bash
npm test
```

Typecheck backend:

```bash
npm run typecheck
```

Build panel:

```bash
npm --prefix panel run build
```

Build project dari root:

```bash
npm run build
```

Whitespace/diff check sebelum commit:

```bash
git diff --check
git status --short
```

---

## 10. Smoke Test API

Public health:

```bash
curl http://localhost:8791/api/v1
```

Public event list:

```bash
curl http://localhost:8791/api/v1/events
```

Public calendar:

```bash
curl "http://localhost:8791/api/v1/events/calendar?month=2026-09"
```

Admin endpoints butuh token:

```bash
curl http://localhost:8791/api/v1/admin/events \
  -H "Authorization: Bearer <token>"
```

---

## 11. Deploy

Build panel:

```bash
npm run build
```

Apply remote migrations jika ada:

```bash
npm run db:migrate:remote
```

Deploy Worker:

```bash
npm run deploy
```

Setelah deploy, cek:

```text
https://bph-cms.sga-cakrawala.org/api/v1
https://bph-cms.sga-cakrawala.org/api/v1/events
https://bph-cms.sga-cakrawala.org/docs/
```

---

## 12. Account Provisioning

Daftar akun/divisi ada di:

```text
docs/DIVISION-ACCOUNTS.md
```

Aturan:

- password produksi jangan disimpan di repo,
- akun dibuat lewat auth service,
- membership dibuat di CMS Hub,
- permission diberikan sesuai role,
- BPH dapat QPR,
- Ristek dan Advokasi dapat Select Workspace,
- semua divisi dapat Event.

---

## 13. Development Order Multi-Divisi

Urutan implementasi yang disarankan:

1. Buat schema `divisions`, `cms_memberships`, `workspace_options`, `audit_logs`.
2. Seed semua divisi dari [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md).
3. Tambah ownership `division_id` di `events`.
4. Tambah `/api/v1/me`.
5. Tambah `loadMembership` middleware.
6. Tambah `requirePermission`.
7. Scope admin event list dan mutations berdasarkan divisi.
8. Tambah feature gate sidebar panel.
9. Tambah Select Workspace untuk Ristek dan Advokasi.
10. Tambah Account & Access page untuk BPH.
11. Baru lanjut QPR.

---

## 14. Troubleshooting

### Wrangler Remote Auth Error

Gejala:

```text
remote session could not be authenticated
```

Solusi:

```bash
npx wrangler whoami
npx wrangler login
```

### AUTH_SERVICE Not Connected

Gejala:

```text
AUTH_SERVICE ... local [not connected]
```

Dampak:

- login admin gagal,
- admin endpoints gagal,
- public endpoints masih bisa dites.

Solusi:

- jalankan auth worker lokal, atau
- set binding agar memakai remote service sesuai konfigurasi Cloudflare.

Untuk local dev sementara, `ALLOW_DEV_AUTH=true` dapat dipakai agar token `dev-token`
diterima sebagai BPH bootstrap. Jangan aktifkan var ini di production.

### Panel Request 401

Solusi:

- hapus token dari localStorage,
- login ulang,
- pastikan user punya membership dan permission.

### Event Tidak Muncul di Public API

Cek:

- event sudah `published`,
- waktu ISO valid,
- `division_id` valid setelah multi-divisi aktif,
- endpoint publik tidak memfilter division yang salah.

---

## 15. Definition of Done

Perubahan dianggap siap jika:

- `npm test` hijau,
- `npm run typecheck` hijau,
- `npm run build` hijau,
- `git diff --check` bersih,
- API contract sesuai [API.md](./API.md),
- permission sensitive dicek di backend,
- dokumen terkait diperbarui.
