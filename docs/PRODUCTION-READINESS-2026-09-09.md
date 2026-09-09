# Production Readiness Report — SGA CMS Hub

**Tanggal:** 9 September 2026  
**Domain production:** `https://bph-cms.sga-cakrawala.org`  
**Worker:** `sga-superapp-bph-cms`  
**Deployment version:** `73b4f9d3-4420-4a58-870b-95a4999870f0`  
**Status akhir:** production sudah running setelah migration D1 remote dan deploy Worker.

> ## ⚠️ Dikoreksi 10 Sep 2026 — jangan pakai laporan ini sebagai acuan keamanan
>
> Laporan ini **catatan historis** dan dibiarkan apa adanya. Tiga klaim di dalamnya
> terbukti salah saat diverifikasi ulang dengan request nyata pada 10 Sep 2026:
>
> | Klaim di laporan ini | Kenyataan saat diverifikasi |
> |---|---|
> | §4 "binding `env.RATE_LIMITER`: rate limit 60 requests/60s" — disebut sebagai kontrol yang aktif | Binding terpasang dan terbaca, tetapi **tidak pernah menegakkan limit**. 200 request beruntun ke `/api/v1/events` → nol 429. Kode yang sama di `wrangler dev` memblokir di request ke-61. |
> | `/auth/sign-in` (tidak dibahas sebagai risiko) | **Tidak dibatasi sama sekali** — brute-force password terbuka. |
> | §8.5 "login BPH berhasil, memberships: 1" | `cms_memberships` production **kosong (0 baris)**. "memberships: 1" itu membership sintetis dari jalur bootstrap email yang di-hardcode, bukan data database. |
>
> §6 juga mencatat official D1 export gagal (`Authentication error [code: 10000]`). Export
> **berhasil** dijalankan 10 Sep 2026 — jadi kegagalan itu gangguan sesaat pada sisi
> Cloudflare, bukan batasan akun atau token.
>
> Kondisi sekarang, perbaikan yang dilakukan, dan hasil verifikasinya ada di
> **[PRODUCTION-READINESS-2026-09-10.md](./PRODUCTION-READINESS-2026-09-10.md)**.

---

## 1. Ringkasan

Production sudah dinaikkan dengan perubahan multi-divisi. Sebelum deploy, dilakukan pengecekan build, typecheck, test, migration, dry-run deploy, dan smoke test endpoint production.

Hasil utama:

- Worker production berhasil deploy.
- D1 remote sudah menjalankan migration `0001_watery_skreet.sql`.
- Endpoint publik tetap sehat setelah migration dan deploy.
- Endpoint admin tanpa token tetap mengembalikan `401 Unauthorized`.
- Login BPH production berhasil dan bisa membaca `/me` serta `/admin/events`.

Catatan penting: tidak ada sistem yang bisa dijamin 100% tanpa risiko, tetapi deployment ini sudah melewati prosedur safety yang wajar untuk production kecil: validasi lokal, validasi remote, backup fallback, migration, deploy, dan smoke test.

---

## 2. Perubahan Besar Yang Sudah Masuk

### 2.1 Multi-Divisi

Repo ini tidak lagi hanya diarahkan untuk akun BPH, tetapi menjadi **SGA CMS Hub** untuk banyak divisi.

Divisi yang diseed ke database:

- BPH
- Ristek
- UKM
- Advokasi
- BNP
- ICD
- Public Relation
- Media

Tabel baru:

- `divisions`
- `cms_memberships`
- `workspace_options`
- `audit_logs`

Kolom baru di `events`:

- `division_id`
- `created_by_user_id`
- `updated_by_user_id`

Event lama sudah dimigrasikan ke divisi BPH supaya tidak ada event tanpa owner.

### 2.2 Permission Per Role

Backend sekarang memakai permission berbasis role dan scope divisi.

Role utama:

- `platform_admin`: akses lintas divisi, QPR, account management, audit log.
- `division_admin`: mengelola event dan media milik divisinya.
- `contributor`: membuat draft dan mengubah draft milik divisinya, tetapi tidak publish/delete.
- `viewer`: read-only untuk event divisinya.

QPR tetap khusus akun dengan permission `qpr.manage`, sehingga divisi non-BPH tidak boleh mengakses QPR.

### 2.3 Special Workspace

Endpoint `/api/v1/me` sekarang mengembalikan `workspace_options`.

Ristek dan Advokasi bisa punya dua pilihan:

- Dashboard Terpadu
- Dashboard khusus eksternal masing-masing

Panel akan menampilkan modal pemilihan workspace jika akun punya lebih dari satu opsi.

---

## 3. Safety Fix Sebelum Deploy

Beberapa hal diperbaiki sebelum production:

- `dev-token` fallback tidak aktif di production, hanya aktif jika `ALLOW_DEV_AUTH=true`.
- Akun selain BPH tidak lagi otomatis mendapat role admin dari prefix email.
- Permission `*.own_division` wajib mengecek ownership resource, tidak boleh lolos hanya karena string permission cocok.
- Update/delete session event sekarang mengecek owner divisi dari event induknya.
- Upload media memakai permission `media.upload.own_division`, bukan role admin global.
- Panel menyembunyikan tombol create/edit/publish/delete sesuai permission user.
- Contributor dibuat draft-aware: boleh create draft dan update draft, tetapi tidak publish/delete.

---

## 4. Verifikasi Sebelum Deploy

Command yang berhasil:

```bash
npm test
npm run typecheck
npm run build
git diff --check
npx wrangler deploy --dry-run
```

Hasil:

- `npm test`: 9 status checks passed.
- `npm run typecheck`: sukses.
- `npm run build`: Vite build sukses.
- `git diff --check`: tidak ada whitespace error.
- `wrangler deploy --dry-run`: bundle Worker valid dan binding terbaca.

Binding production yang terdeteksi saat dry-run/deploy:

- `env.DB`: D1 Database `bph-cms-db`
- `env.BUCKET`: R2 Bucket `bph-cms-media`
- `env.AUTH_SERVICE`: Worker `sga-superapp-auth`
- `env.RATE_LIMITER`: rate limit `60 requests/60s`
- `env.ASSETS`: panel static assets
- `env.API_BASE_URL`: `https://bph-cms.sga-cakrawala.org/api/v1`
- `env.CORS_ORIGIN`
- `env.DOCS_ALLOW_EMAILS`

---

## 5. Database Production

Sebelum migration, D1 remote masih pending:

```text
0001_watery_skreet.sql
```

Migration remote dijalankan:

```bash
npm run db:migrate:remote
```

Hasil:

```text
0001_watery_skreet.sql ✅
```

Verifikasi setelah migration:

- Tidak ada pending migration.
- `divisions_count = 8`
- `events_without_division = 0`
- Endpoint public `/api/v1/events` tetap `200`.

---

## 6. Backup / Restore Point

Cloudflare D1 official export sempat dicoba:

```bash
npx wrangler d1 export bph-cms-db --remote --output backups/bph-cms-db-pre-multidivisi-2026-09-09.sql --skip-confirmation
```

Tetapi gagal dari Cloudflare API dengan:

```text
Authentication error [code: 10000]
```

Sebagai fallback, data penting production sebelum migration diambil via query read-only dan disimpan di:

```text
backups/bph-cms-db-pre-multidivisi-2026-09-09-fallback.sql
```

Isi backup fallback:

- 3 row `events`
- 1 row `event_sessions`

Catatan: file ini backup data utama, bukan full dump resmi D1.

---

## 7. Deployment Production

Deploy dijalankan setelah migration remote berhasil:

```bash
npm run deploy
```

Hasil:

```text
Uploaded sga-superapp-bph-cms
Deployed sga-superapp-bph-cms triggers
bph-cms.sga-cakrawala.org
Current Version ID: 73b4f9d3-4420-4a58-870b-95a4999870f0
```

---

## 8. Smoke Test Setelah Deploy

### 8.1 Public Health

```bash
curl https://bph-cms.sga-cakrawala.org/api/v1
```

Hasil:

```text
HTTP 200
BPH CMS is running
```

### 8.2 Public Events

```bash
curl https://bph-cms.sga-cakrawala.org/api/v1/events
```

Hasil:

```text
HTTP 200
total published events: 2
```

Event yang tampil:

- `cakrawala-arena-2026`
- `rusdimng`

### 8.3 Public Calendar

```bash
curl "https://bph-cms.sga-cakrawala.org/api/v1/events/calendar?month=2026-09"
```

Hasil:

```text
HTTP 200
items: 2
```

### 8.4 Admin Tanpa Token

```bash
curl https://bph-cms.sga-cakrawala.org/api/v1/admin/events
curl https://bph-cms.sga-cakrawala.org/api/v1/me
```

Hasil:

```text
HTTP 401 Unauthorized
```

Ini benar, karena endpoint admin wajib login.

### 8.5 Login BPH Production

Login BPH dites end-to-end tanpa mencetak token ke output.

Hasil:

```text
login 200 true
me 200 { email: 'bph@cakrawala.com', memberships: 1, workspaces: 1 }
admin_events 200 { items: 3 }
```

Artinya:

- login BPH berhasil,
- `/me` berhasil membaca user + membership,
- `/admin/events` berhasil membaca 3 event admin termasuk draft.

---

## 9. Status Risiko

### Aman Untuk Production Saat Ini

- Public API tetap berjalan.
- Admin API tetap protected.
- Schema D1 sudah sesuai kode.
- BPH login flow berhasil.
- Worker binding production terbaca.
- Panel production sudah build dan deploy.

### Risiko Yang Masih Perlu Diperhatikan

- Full official D1 export gagal dari Cloudflare API, jadi backup yang ada adalah fallback data utama, bukan full export resmi.
- Akun divisi lain perlu dibuat/diaktifkan di auth service dan diberi `cms_membership` agar bisa login ke CMS Hub.
- Perlu test manual login untuk Ristek/Advokasi/divisi lain setelah account auth service tersedia.
- Jika ingin contributor benar-benar punya workflow approval, masih perlu modul approval terpisah. Saat ini contributor hanya dibatasi draft-only.

---

## 10. Checklist Operasional Berikutnya

Setelah deploy ini, langkah lanjutan yang disarankan:

1. Buat akun auth service untuk semua divisi sesuai `docs/DIVISION-ACCOUNTS.md`.
2. Tambahkan membership di `cms_memberships` untuk user divisi.
3. Test login tiap divisi.
4. Pastikan Ristek dan Advokasi melihat modal workspace.
5. Test divisi non-BPH tidak bisa membuka QPR.
6. Test divisi A tidak bisa edit event divisi B.
7. Coba official D1 export lagi dari environment yang tidak terkena error Cloudflare API.

---

## 11. Kesimpulan

Production sudah running dengan versi multi-divisi dan smoke test utama berhasil.

Secara praktis, sistem sudah aman untuk dipakai BPH dan siap dilanjutkan ke onboarding akun divisi lain, dengan catatan akun/membership divisi harus dibuat dulu sebelum masing-masing divisi bisa login.
