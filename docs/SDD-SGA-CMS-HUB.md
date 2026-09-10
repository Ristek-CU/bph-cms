# SDD — SGA CMS Hub Multi-Divisi

**Versi:** 0.2
**Tanggal:** 10 September 2026 (v0.1: 7 September 2026)
**Status:** Desain teknis untuk Phase 1–2 (sudah live) + desain baru untuk Phase 3 (One Identity) dan Phase 6 (Modul Form)
**Scope:** Multi-division access, account provisioning, event ownership, special workspace routing, **SSO handoff antar dashboard**, **modul Form/Campaign lintas divisi**
**Terkait:** [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md) (visi & keputusan D-A/D-B ada di §1), [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md), [SDD.md](./SDD.md), [API.md](./API.md)

> **Bagian yang sudah live** (§3.1–§3.6, §4.1–§4.5, §5.1–§5.3, §6) mendeskripsikan sistem
> yang di-deploy ke production. §3.1–§3.6 / §4.1–§4.4 / §5.1–§5.3 live sejak 9 Sep 2026;
> §4.5 (SSO handoff) sisi Hub live sejak 10 Sep 2026 (commit `c485574`).
> **Bagian yang masih desain** ditandai 🆕: §3.7 (modul Form) dan §5.4 (API Form). Belum
> ada kodenya — `src/modules/` saat ini berisi `accounts`, `audit`, `events`, `handoff`,
> `me`, `media`, `openapi`.

---

## 1. Tujuan Desain

Repo ini berubah arah dari CMS BPH menjadi **SGA CMS Hub**. Tujuan teknisnya:

- satu dashboard untuk semua divisi,
- akun per divisi,
- fitur dibuka sesuai permission,
- Event bisa dipakai semua divisi,
- QPR tetap khusus BPH,
- Ristek dan Advokasi bisa memilih Dashboard Terpadu atau dashboard khusus milik mereka,
- 🆕 **pemilihan dashboard itu benar-benar memindahkan sesi**, bukan melempar user ke
  halaman login lain (D-A),
- 🆕 **setiap divisi selain Advokasi bisa membangun form sendiri** (D-B, PRD §7.2-E).

Desain ini tidak mengganti auth utama. Auth tetap memakai service `sga-superapp-auth`.
CMS Hub hanya menyimpan membership, permission, ownership data, dan audit log.

Prinsip yang sama sekarang diberlakukan ke seluruh ekosistem: setelah D-A, **tidak ada
aplikasi SGA yang menyimpan tabel user sendiri**. `AdvocationDashboard` adalah satu-satunya
yang masih melanggar, dan itu yang dibongkar di Phase 3.

---

## 2. Prinsip Arsitektur

| Prinsip | Keputusan |
|---|---|
| Auth source | Tetap `AUTH_SERVICE`, jangan buat password table di CMS Hub. |
| Auth source (ekosistem) | 🆕 **Satu penerbit sesi untuk semua app SGA.** `AdvocationDashboard` pindah dari Auth.js Credentials + tabel `User` lokal ke validasi sesi `AUTH_SERVICE` (D-A). |
| Access model | Role + permission + division scope. |
| Default access | Deny by default. |
| Event ownership | Setiap event punya `division_id`. |
| Form ownership | 🆕 Setiap form punya `division_id`, sama seperti event (D-B). |
| QPR | Permission khusus BPH: `qpr.manage`. |
| Special workspace | Ristek dan Advokasi punya opsi redirect ke dashboard khusus. |
| Workspace handoff | 🆕 Handoff **tidak boleh** membawa kredensial di URL. Karena penerbit sesinya sudah sama setelah D-A, yang dibawa cukup referensi sesi yang aman. |
| Batas modul | 🆕 Hub **tidak** mengambil alih data Campaign/Submission/Report Advokasi. Modul Form Hub adalah tabel baru, bukan hasil migrasi. |
| Audit | Semua aksi admin penting dicatat. |

---

## 3. Data Model

### 3.1 `divisions`

```sql
CREATE TABLE divisions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  dashboard_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX divisions_slug_idx ON divisions (slug);
```

Seed awal:

| slug | name | email | dashboard_url |
|---|---|---|---|
| `bph` | BPH | `bph@cakrawala.com` | null |
| `ristek` | Ristek | `ristek@cakrawala.com` | TBD |
| `ukm` | UKM | `ukm@cakrawala.ac.id` | null |
| `advo` | Advokasi | `advo@cakrawala.ac.id` | TBD |
| `bnp` | BNP | `bnp@cakrawala.ac.id` | null |
| `icd` | ICD | `icd@cakrawala.ac.id` | null |
| `pr` | Public Relation | `pr@cakrawala.ac.id` | null |
| `media` | Media | `media@cakrawala.ac.id` | null |

### 3.2 `cms_memberships`

```sql
CREATE TABLE cms_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'division_admin', 'contributor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cms_memberships_user_division_unique ON cms_memberships (user_id, division_id);
CREATE INDEX cms_memberships_user_idx ON cms_memberships (user_id);
CREATE INDEX cms_memberships_email_idx ON cms_memberships (user_email);
```

Catatan:

- `user_id` berasal dari auth service.
- `user_email` disimpan sebagai cache agar admin panel mudah menampilkan daftar user.
- Satu user bisa punya lebih dari satu membership jika nanti dibutuhkan.

### 3.3 `role_permissions`

Untuk v1, permissions bisa diseed static di kode. Kalau butuh editable lewat panel, pindahkan ke DB.

```ts
const ROLE_PERMISSIONS = {
  platform_admin: [
    "events.read.all",
    "events.create.all",
    "events.update.all",
    "events.publish.all",
    "forms.read.all",            // 🆕 D-B
    "forms.create.all",
    "forms.update.all",
    "forms.publish.all",
    "forms.submissions.read.all",
    "qpr.manage",
    "accounts.manage",
    "audit.read",
  ],
  division_admin: [
    "events.read.own_division",
    "events.create.own_division",
    "events.update.own_division",
    "events.publish.own_division",
    "forms.read.own_division",          // 🆕 D-B
    "forms.create.own_division",
    "forms.update.own_division",
    "forms.publish.own_division",
    "forms.submissions.read.own_division",
    "media.upload.own_division",
  ],
  contributor: [
    "events.read.own_division",
    "events.create_draft.own_division",
    "events.update_draft.own_division",
    "forms.read.own_division",               // 🆕 D-B
    "forms.create_draft.own_division",
    "forms.update_draft.own_division",
    "media.upload.own_division",
  ],
  viewer: [
    "events.read.own_division",
    "forms.read.own_division",   // 🆕 D-B
  ],
};
```

Catatan implementasi v1:

- `events.create_draft.own_division` boleh memakai endpoint create event karena event baru selalu dibuat sebagai draft.
- `events.update_draft.own_division` hanya boleh mengubah event milik divisinya ketika status event masih `draft`.
- Contributor tidak punya `events.publish.*` dan `events.delete.*`.
- 🆕 Aturan yang sama berlaku identik untuk `forms.*`: form baru selalu dibuat sebagai
  draft, contributor tidak punya `forms.publish.*`, dan `forms.submissions.read.*` **tidak**
  diberikan ke contributor maupun viewer — membaca jawaban responden adalah wewenang
  division_admin ke atas.


### 3.4 `workspace_options`

```sql
CREATE TABLE workspace_options (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cms_hub', 'external_dashboard')),
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX workspace_options_division_idx ON workspace_options (division_id, sort_order);
```

Seed:

- Ristek: `SGA CMS Hub`, `Dashboard Ristek`
- Advokasi: `SGA CMS Hub`, `Dashboard Advokasi`

### 3.5 `audit_logs`

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_email TEXT,
  actor_division_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id);
```

### 3.6 Update `events`

Tambahkan ownership:

```sql
ALTER TABLE events ADD COLUMN division_id TEXT REFERENCES divisions(id);
ALTER TABLE events ADD COLUMN created_by_user_id TEXT;
ALTER TABLE events ADD COLUMN updated_by_user_id TEXT;
CREATE INDEX events_division_idx ON events (division_id);
CREATE INDEX events_division_status_starts_idx ON events (division_id, status, starts_at_ms);
```

Migration rule:

- event lama yang belum punya `division_id` dimigrasikan ke BPH.

### 3.7 🆕 Modul Form/Campaign Lintas Divisi

> **Status: desain, belum dibangun.** Mewujudkan D-B (PRD §1.2) dan spesifikasi produk
> PRD §7.2-E. Butuh **PRD Form tersendiri disetujui dulu** sebelum implementasi dimulai —
> tipe field v1, kebijakan identitas pengisi, dan kebutuhan approval masih terbuka
> (PRD §7.5).

#### Prinsip desain

| Prinsip | Keputusan | Alasan |
|---|---|---|
| Bukan hasil migrasi | Semua tabel di bawah **baru**. Tidak ada data Advokasi yang dipindah | D-B. Menghindari proxy URL permanen dan melindungi kontrak `POST /api/v1/reports` yang 1:1 Laravel |
| Ownership divisi | Setiap form punya `division_id` NOT NULL | Mengikuti pola `events`. Object-level authorization bisa dipakai ulang dari §4.4 tanpa middleware baru |
| Status & jendela waktu | `status` disimpan, **periode buka–tutup dihitung server** | Mengikuti pola Event (`CONTEXT.md` §6). FE tidak boleh menyimpulkan sendiri form masih buka |
| Kolom epoch ms | `opens_at_ms` / `closes_at_ms` INTEGER | Mengikuti D5 di `PLAN.md`: sort/filter di SQL tanpa parsing varian offset ISO. API tetap kirim ISO 8601 + offset |
| Skema dibekukan saat publish | `form_fields` tidak boleh diedit setelah ada submission | Jawaban lama jadi tidak bisa dibaca kalau field-nya berubah. Ini pelajaran dari builder Advokasi |
| D1 constraint | **Tanpa `$transaction`, tanpa BigInt** | Batasan D1. Insert submission + answers + files = sequential dengan cleanup manual di `catch`, pola yang sudah terbukti di AdvocationDashboard |

#### 3.7.1 `forms`

```sql
CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  opens_at TEXT,
  closes_at TEXT,
  opens_at_ms INTEGER,
  closes_at_ms INTEGER,
  identity_policy TEXT NOT NULL DEFAULT 'optional'
    CHECK (identity_policy IN ('anonymous', 'optional', 'required')),
  max_submissions_per_fingerprint INTEGER,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX forms_division_idx ON forms (division_id, status);
CREATE INDEX forms_slug_idx ON forms (slug);
CREATE INDEX forms_window_idx ON forms (status, opens_at_ms, closes_at_ms);
```

Catatan:

- `ON DELETE RESTRICT` untuk `division_id` — sama seperti `cms_memberships`. Form tidak
  boleh jadi yatim kalau divisi dihapus.
- `slug` unik global, bukan unik per divisi. Alasannya: slug muncul di URL publik yang
  dibagikan, dan slug yang sama di dua divisi akan membingungkan serta membuka ruang
  sengketa nama. Konsekuensinya perlu aturan first-come-first-served yang dicatat di
  PRD Form.
- `identity_policy` **placeholder** — nilainya belum diputuskan (PRD §7.5). Kolomnya
  disiapkan supaya keputusan itu tidak menuntut migrasi skema.
- `status` dihitung + disimpan, bukan diturunkan murni dari waktu, karena ada `closed`
  manual (divisi mau menutup lebih awal) dan `archived`. Berbeda dari Event yang statusnya
  murni turunan timestamp.

#### 3.7.2 `form_fields`

```sql
CREATE TABLE form_fields (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX form_fields_form_idx ON form_fields (form_id, sort_order);
```

- `type` **sengaja tidak di-constrain dengan CHECK** di skema. Daftar tipe field v1 belum
  diputuskan (PRD §7.5) dan CHECK constraint di D1 mahal untuk diubah. Validasi tipe
  dilakukan di lapisan aplikasi terhadap allowlist eksplisit.
- `config` = JSON string untuk opsi per tipe (pilihan jawaban, min/max, accept extension,
  jumlah file maksimum). Mengikuti pola `FormField` Advokasi yang sudah terbukti.
- Aturan pembekuan: setelah `forms.status != 'draft'`, endpoint update field harus menolak
  perubahan `type` dan penghapusan field. Menambah field baru boleh dipertimbangkan, tapi
  keputusannya ada di PRD Form.

#### 3.7.3 `form_submissions`

```sql
CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  fingerprint_hash TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  respondent_name TEXT,
  respondent_email TEXT,
  submitted_at TEXT NOT NULL,
  submitted_at_ms INTEGER NOT NULL
);
CREATE INDEX form_submissions_form_idx ON form_submissions (form_id, submitted_at_ms);
```

- `fingerprint_hash` disimpan **sudah di-hash**, tidak pernah plaintext. Dipakai untuk
  rate limit per pengisi dan menegakkan `max_submissions_per_fingerprint`.
- `respondent_name` / `respondent_email` hanya diisi bila `identity_policy` mengizinkan.
  Bila `is_anonymous = 1`, keduanya NULL dan panel tidak boleh menampilkannya.
- Tidak ada kolom `division_id` di sini — divisi diturunkan dari `forms`. Menyimpannya
  dua kali membuka peluang tidak konsisten.

#### 3.7.4 `form_answers`

```sql
CREATE TABLE form_answers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES form_fields(id) ON DELETE RESTRICT,
  value_text TEXT,
  value_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX form_answers_submission_idx ON form_answers (submission_id);
CREATE INDEX form_answers_field_idx ON form_answers (field_id);
```

- `value_text` untuk jawaban tunggal, `value_json` untuk multi-value (checkbox, pilihan
  ganda). Dua kolom terpisah supaya rekap distribusi jawaban bisa di-query tanpa parsing
  JSON untuk kasus sederhana.
- `field_id` pakai `ON DELETE RESTRICT` — jawaban tidak boleh jadi yatim. Ini alasan
  kenapa field yang sudah punya jawaban tidak boleh dihapus.

#### 3.7.5 `form_files`

```sql
CREATE TABLE form_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES form_fields(id) ON DELETE RESTRICT,
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX form_files_submission_idx ON form_files (submission_id);
```

- `size_bytes` pakai **INTEGER, bukan BigInt** — batasan D1. Berlaku juga untuk agregasi
  ukuran; jangan `SUM()` ke nilai yang bisa melampaui 32-bit tanpa casting.
- File disimpan di R2 bucket `bph-cms-media` yang **sudah ada**, di bawah prefix terpisah
  `forms/{form_id}/submissions/{submission_id}/{uuid}.{ext}` — mengikuti pola media event
  dan pola Advokasi (`reports/{id}/files/{uuid}.{ext}`).
- Nama file di R2 diacak; `original_filename` hanya untuk tampilan, dan **tidak boleh**
  dipakai sebagai path. Disajikan lewat `/api/v1/storage/*` yang sudah ada, bukan URL
  publik bucket.

#### 3.7.6 Urutan tulis (D1 tanpa transaction)

Insert satu submission menyentuh 3 tabel. Tanpa transaction, urutannya harus bisa
dibersihkan kalau gagal di tengah:

```text
1. validasi seluruh payload terhadap form_fields yang dibaca ulang dari DB
2. upload file ke R2            -> kumpulkan r2_key
3. INSERT form_submissions
4. INSERT form_answers (loop)
5. INSERT form_files   (loop)
   on error di 3/4/5 -> DELETE objek R2 yang sudah terupload,
                      DELETE form_answers/form_files yang sudah masuk,
                      DELETE form_submissions,
                      balikan 500 dengan pesan generik
```

Ini pola yang sama dengan yang sudah berjalan di AdvocationDashboard. **Jangan** mencoba
membungkusnya dalam transaction — D1 tidak mendukung.

#### 3.7.7 Yang belum diputuskan di lapisan data

- Daftar nilai `form_fields.type` untuk v1.
- Apakah perlu `form_submission_status` (mis. untuk moderasi) — bergantung pada keputusan
  approval di PRD Form.
- Retensi data: berapa lama submission disimpan setelah form `archived`. Ini menyangkut
  data pribadi mahasiswa dan **harus** dijawab sebelum modul dipakai, bukan sesudah.
- Apakah Hub menarik ringkasan campaign Advokasi secara read-only (PRD §1.4). Kalau ya,
  itu butuh service binding baru ke `AdvocationDashboard` dan tidak boleh jadi join lintas DB.

---

## 4. Auth & Permission Flow

### 4.1 Current Flow

```text
request -> adminAuth -> AUTH_SERVICE /v1/access/session -> requireRole("admin")
```

### 4.2 Target Flow

```text
request
  -> adminAuth
  -> loadCmsMemberships(user_id)
  -> set activeDivision
  -> requirePermission(permission, resourceScope)
  -> controller
```

### 4.3 `GET /api/v1/me`

Panel butuh endpoint untuk render menu.

Response:

```json
{
  "success": true,
  "message": "OK",
  "statusCode": 200,
  "data": {
    "user": {
      "id": "user_id",
      "email": "ristek@cakrawala.com",
      "name": "Ristek"
    },
    "memberships": [
      {
        "division": { "id": "...", "slug": "ristek", "name": "Ristek" },
        "role": "division_admin",
        "permissions": ["events.read.own_division", "events.create.own_division"]
      }
    ],
    "workspace_options": [
      { "label": "Dashboard Terpadu", "kind": "cms_hub", "url": null },
      { "label": "Dashboard Ristek", "kind": "external_dashboard", "url": "https://..." }
    ]
  }
}
```

### 4.4 Permission Middleware

```ts
requirePermission("events.update", {
  scope: "own_division",
  resourceLoader: loadEventById,
});
```

Rules:

- `*.all` boleh lintas divisi.
- `*.own_division` hanya jika `resource.division_id === activeMembership.division_id`.
- Jika tidak ada match, return 403.
- Jika resource tidak ada, return 404.
- Jangan bocorkan data divisi lain dari error detail.
- 🆕 Berlaku identik untuk `forms.*` — object-level authorization membaca
  `forms.division_id`, dan untuk submission membaca `division_id` dari form induknya
  (persis pola yang sudah dipakai untuk session event: cek owner dari induk, bukan dari
  baris anak).

### 4.5 🆕 SSO Handoff Antar Dashboard (D-A)

> **Status: sisi Hub selesai & live 10 Sep 2026 (commit `c485574`). Sisi Advokasi sudah
> ditulis tapi belum di-commit, belum di-deploy, dan punya bug kontrak yang menggagalkan
> handoff 100%.** Mewujudkan KR6 (PRD §4) dan keputusan D-A (PRD §1.2).
>
> Yang sudah jalan di production: tabel `workspace_handoffs` (migration
> `0003_wide_hellcat.sql`), `POST /api/v1/admin/workspace-handoff`,
> `POST /api/v1/internal/handoff/exchange`, dan `handleSelectWorkspace` di panel.
>
> **Sisi `AdvocationDashboard` (diverifikasi 11 Sep 2026):** `src/app/sso/route.ts`,
> `src/app/sso/error/page.tsx`, dan `src/lib/sso.ts` **sudah ada di working tree** tapi
> masih **untracked** (`?? src/app/sso/`, `?? src/lib/sso.ts` di `git status`) — belum
> di-commit, belum di-push. `.env.example`-nya juga sudah declaring `HUB_INTERNAL_URL` dan
> `HANDOFF_SHARED_SECRET`. Konsisten dengan itu, production
> `https://satgas.sga-cakrawala.org/sso` menjawab **404** (diprobe dengan dan tanpa
> `?code=`). Jadi handoff **belum bisa diuji end-to-end lintas origin**.
>
> 🔴 **Bug kontrak (D-T di register keputusan Ristek) — menggagalkan handoff 100% bahkan
> setelah secret dipasang.** `AdvocationDashboard/src/lib/sso.ts:44` mem-parse respons di
> **root**:
>
> ```ts
> exchangeSchema.safeParse(await response.json())   // schema: { user_id, email, name }
> ```
>
> padahal Hub membalas **ter-wrapper** (`handoff.route.ts:202-206` lewat `ApiResponse.ok`):
> `{ success, message, statusCode, data: { user_id, email, name } }`. Test Hub
> `src/handoff.test.ts:105-106` mengunci bentuk itu (`good.body?.data?.user_id`). Zod
> secara default men-strip key yang tidak dikenal → hasil parse `{}` → `user_id` required
> → `safeParse` gagal → `exchangeHandoffCode` return `null` →
> `redirect('/sso/error?reason=invalid_code')`.
> **Yang salah sisi Advokasi** — wrapper `{ success, message, statusCode, data }` adalah
> kontrak final seluruh ekosistem (`CONTEXT.md` §2, `PLAN.md` D2). Perbaikannya: parse
> `body.data`, atau bikin schema wrapper-nya eksplisit.
>
> Catatan: route `/sso` Advo masih memetakan email ke baris `model User` lokal
> (`getPrisma().user.findUnique({ where: { email } })`) dan menerbitkan cookie lewat
> `next-auth/jwt` `encode`. Artinya **D-A belum dikerjakan** — ini jalur pemetaan sementara
> yang justru dihindari D-A, dan sesuai §4.5 di bawah ("Tanpa D-A, langkah 5 tetap bisa
> jalan tapi Advokasi harus memetakan `user_id`/email dari Hub ke baris `model User`
> lokalnya").
>
> ⚠️ `HANDOFF_SHARED_SECRET` **belum di-set** di Worker production (`wrangler secret list`
> → kosong, diverifikasi 11 Sep 2026). Endpoint exchange karenanya fail-closed: membalas
> `503 "Handoff exchange belum dikonfigurasi"` untuk semua pemanggil. Ini aman, tapi
> artinya langkah 5 di flow bawah belum bisa jalan sampai secret-nya dipasang di Worker
> Hub **dan** di sisi Advokasi (`HANDOFF_SHARED_SECRET` + `HUB_INTERNAL_URL`).
>
> Bagian "Kondisi sebelum perbaikan" di bawah adalah **catatan historis** — dibiarkan
> supaya alasan desainnya tidak hilang.

#### Kondisi sebelum perbaikan — kenapa ini dulu belum jalan

```text
Panel Hub: WorkspaceModal.jsx -> onSelect(ws)
App.jsx:93-98:  if (ws.kind === "external_dashboard" && ws.url)
                    window.location.href = ws.url        // <- redirect telanjang
```

Tidak ada yang dibawa. Diukur 10 Sep 2026:

| URL | Hasil |
|---|---|
| `https://satgas.sga-cakrawala.org` | `HTTP 307 → /login` — user harus login ulang, dengan kredensial yang berbeda |
| `https://ristek.sga-cakrawala.org` | `HTTP 000` — **tidak resolve**. URL ini sudah ter-seed di D1 production (`drizzle/0001_watery_skreet.sql:73`) dan tombolnya sudah tampil di panel. **Sudah diberesi** 10 Sep 2026: barisnya di-set `is_active = 0` langsung di D1, jadi `/api/v1/me` tidak lagi mengembalikannya |

Akar masalahnya bukan redirect-nya: **ekosistem punya dua penerbit sesi yang tidak saling
kenal.** `bph-cms` memvalidasi sesi dari `sga-superapp-auth` (better-auth);
`AdvocationDashboard` menerbitkan JWT-nya sendiri lewat Auth.js v5 Credentials dengan
`model User` + `model PasswordResetToken` di D1 lokal.

#### Target flow setelah D-A

> **Dikoreksi 10 Sep 2026.** Versi awal bagian ini menulis bahwa setelah D-A "handoff jadi
> trivial, tidak butuh protokol tukar token" dan menyarankan cookie di domain induk
> `.sga-cakrawala.org`. **Keduanya salah** setelah kode-nya dibaca ulang:
>
> - Panel Hub menyimpan token di **`localStorage`** (`bph_cms_token`, `panel/src/App.jsx:30`),
>   dan `localStorage` **terisolasi per origin**. `satgas.sga-cakrawala.org` tidak bisa
>   membaca localStorage `bph-cms.sga-cakrawala.org` — dilarang browser, bukan soal
>   konfigurasi.
> - Backend Hub **menolak cookie secara sengaja**. `src/middlewares/admin-auth.ts:14-18`:
>   *"Hanya Bearer. Cookie sengaja tidak diterima … menerima cookie menambah permukaan
>   CSRF tanpa ada satu pun klien yang membutuhkannya."*
>
> Jadi walaupun penerbit sesinya sudah sama, **tetap butuh mekanisme pemindahan** antar
> origin. D-A bukan menghapus kebutuhan itu — D-A menghapus kebutuhan **tabel pemetaan
> user** di sisi Advokasi.

Mekanisme yang memenuhi kedua batasan di atas adalah **one-time handoff code**
(pola authorization-code):

```text
1. User login di Hub
   -> POST /api/v1/auth/sign-in (proxy ke AUTH_SERVICE /v1/access/sign-in)
   -> dapat token, disimpan di localStorage panel

2. GET /api/v1/me -> workspace_options (sudah difilter is_active)

3. User pilih "Dashboard Advokasi"

4. Panel: POST /api/v1/admin/workspace-handoff { workspace_option_id }   [Bearer]
   -> Hub bikin kode acak entropi tinggi, simpan di D1:
      { code, user_id, target_division_id, expires_at (+-60 detik), used_at: null }
   -> Hub balas { redirect_to: "<ws.url>/sso?code=<code>" }
   -> panel: window.location.href = redirect_to

5. AdvocationDashboard route /sso (server-side, bukan client)
   -> tukar code ke Hub server-to-server:
      POST <HUB_INTERNAL>/api/v1/internal/handoff/exchange { code }
   -> Hub: cek belum dipakai + belum kadaluarsa -> tandai used_at -> balas
      { user_id, email, name }
   -> Advokasi cek user itu memang admin Advokasi (allowlist/izin internal)
   -> Advokasi set COOKIE HttpOnly miliknya sendiri
   -> redirect ke /dashboard
```

Kenapa code di URL boleh, padahal token di URL dilarang:

| | Token di URL | One-time code di URL |
|---|---|---|
| Bisa dipakai ulang | Ya, sampai kadaluarsa | **Tidak** — sekali pakai, ditandai `used_at` |
| Umur | 7 hari (sesi better-auth) | ±60 detik |
| Berguna tanpa langkah server | Ya — langsung jadi identitas | **Tidak** — harus ditukar oleh worker Advokasi ke Hub |
| Bocor di Referer/history/log | = sesi penuh dicuri | = kode mati, sudah terpakai/kadaluarsa |

`ACCOUNTS-ACCESS.md` §6 melarang "redirect membawa password" dan meminta
"session/token yang aman dari auth service". Kode sekali pakai memenuhi itu: yang
dibawa bukan kredensial, dan sesi sesungguhnya dibuat oleh cookie HttpOnly milik
Advokasi sendiri.

#### Kebutuhan implementasi

| Sisi | Yang harus dibuat |
|---|---|
| Hub — DB | Tabel `workspace_handoffs` (`code` PK, `user_id`, `division_id`, `target_workspace_id`, `expires_at`, `used_at`, `created_at`) |
| Hub — API | `POST /api/v1/admin/workspace-handoff` (Bearer, permission sesuai membership) dan `POST /api/v1/internal/handoff/exchange` (**hanya** bisa dipanggil worker Advokasi — service binding atau shared secret, bukan endpoint publik) |
| Hub — panel | `App.jsx:93-98` `handleSelectWorkspace`: untuk `external_dashboard`, panggil endpoint handoff dulu, baru redirect ke URL yang dibalas. Jangan `window.location.href = ws.url` telanjang |
| Advokasi | Route `/sso`, tukar code server-to-server, cek izin internal, set cookie sendiri |
| Advokasi (D-A) | Validasi sesi berikutnya lewat `AUTH_SERVICE`, bukan JWT Auth.js lokal |

Tanpa D-A, langkah 5 tetap bisa jalan tapi Advokasi harus **memetakan** `user_id`/email
dari Hub ke baris `model User` lokalnya — artinya dua identitas yang harus disinkronkan
selamanya. D-A menghapus pemetaan itu.

#### ⚠️ Blocker yang ditemukan saat memeriksa ini: repo auth ≠ production

Hub memanggil `AUTH_SERVICE` di path **`/v1/access/*`**:

- `src/middlewares/admin-auth.ts:35` → `http://internal/v1/access/session`
- `src/index.ts:142-143` → `http://internal/v1/access/${path}`
- Commit `9e16c71` (2026-09-03): *"service auth superapp redeploy pindah path
  `/v1/auth/*` ke `/v1/access/*`"*

Tapi source `sga-superapp/apps/auth` di repo masih:

- `src/libs/better-auth/options.ts:29` → `basePath: "/v1/auth"`
- `src/index.ts:71` → `v1.on(["GET","POST"], "/auth/*", …)` di bawah `app.route("/v1", v1)`
- **Tidak ada** string `/v1/access` di mana pun dalam `apps/auth`
- Tidak ada rewrite di `gateway-api` maupun `wrangler.toml`
- Commit terakhir `apps/auth`: **2026-08-20** (`ef04dbe`), working tree bersih

Binding Hub menunjuk worker `sga-superapp-auth` langsung (`wrangler.jsonc:44-48`), jadi
tidak ada gateway yang bisa me-rewrite path. Kesimpulannya: **worker auth yang
ter-deploy menjalankan kode yang tidak ada di repo `sga-superapp`.**

Akibatnya: siapa pun yang men-deploy ulang `apps/auth` dari repo apa adanya akan
**mematikan login bph-cms** — `/v1/access/session` jadi 404, sehingga setiap endpoint
admin Hub mengembalikan 401. Ini harus diberesi **sebelum** Phase 3, karena Phase 3
menambah satu lagi konsumen auth service.


#### Aturan yang mengikat

| Aturan | Alasan |
|---|---|
| **Dilarang** membawa token/kredensial di query string | `ACCOUNTS-ACCESS.md` §6 sudah melarang. Bocor lewat Referer, browser history, dan log server |
| ~~Cookie sesi di scope domain induk `.sga-cakrawala.org`~~ | ❌ **Dicabut 10 Sep 2026.** Hub menyimpan token di `localStorage` (terisolasi per origin) dan backend-nya **menolak cookie secara sengaja** (`admin-auth.ts:14-18`, alasan: permukaan CSRF). Cookie bersama bukan jalur yang tersedia tanpa merombak desain auth Hub |
| Pemindahan antar origin pakai **one-time code** | Sekali pakai, TTL ±60 detik, harus ditukar server-to-server. Lihat flow di atas |
| Advokasi validasi sesi ke `AUTH_SERVICE` via service binding | Meniru pola yang sudah live di `bph-cms` (`wrangler.jsonc:44-48`) dan pola `gateway-api/src/middlewares/auth.ts` di superapp |
| Advokasi **tidak** menyimpan password | Keputusan final `CONTEXT.md` §2. Tabel `User` dan `PasswordResetToken` dihapus |
| Izin internal tetap milik aplikasi tujuan | Auth service menjawab "siapa ini", bukan "boleh apa di sini". Pemetaan user_id → peran admin Advokasi tetap di sisi Advokasi |
| Endpoint tukar kode **bukan** endpoint publik | Hanya boleh dipanggil worker Advokasi (service binding atau shared secret). Kalau publik, siapa pun bisa menukar kode orang lain |

#### Peralihan — bagian paling berisiko

AdvocationDashboard sedang **live dan dipakai**. Yang wajib direncanakan sebelum kode
ditulis:

1. **Pemetaan user existing.** Setiap baris `model User` Advokasi harus punya padanan di
   auth service **sebelum** auth lokal dimatikan. Email adalah kunci alami, tapi harus
   diverifikasi — tidak boleh ada asumsi bahwa semua admin Advokasi sudah terdaftar di
   auth service.
2. **Tidak boleh ada yang terkunci keluar.** Butuh jendela di mana kedua jalur diterima
   (auth lokal **atau** auth service), baru kemudian auth lokal dicabut. Bukan switch
   sekali jalan.
3. **Kolom audit.** `created_by` / `updated_by` / `deleted_by` menyimpan **nama** user
   login (string bebas, bukan foreign key). Setelah peralihan, sumber nama pindah ke profil
   auth service. Nilai historis **tidak ditulis ulang** — itu akan memalsukan riwayat.
4. **Halaman `(auth)/*`** (login, register, forgot-password, reset-password) dihapus atau
   diarahkan ke Hub. Catatan: reset password Advokasi saat ini hanya mencetak link ke
   console (`[MAIL LOG]`), tidak mengirim email — setelah D-A tanggung jawab itu pindah ke
   auth service sepenuhnya.
5. **Rate limit login & throttle ganti password** di sisi Advokasi jadi tidak relevan dan
   ikut dicabut; pembatasan pindah ke auth service.
6. **Settings → hapus akun** harus dicabut atau diubah artinya. Menghapus akun di auth
   service berdampak ke seluruh ekosistem, bukan cuma ke Advokasi — ini bukan lagi
   keputusan satu aplikasi.

#### Yang tidak berubah

Modul data, endpoint publik, URL/QR yang sudah tersebar, dan storage Advokasi **tidak
disentuh** — batas lengkapnya di PRD §1.3.

#### Sebelum Phase 3 dikerjakan: beresi dulu URL mati

`workspace_options` baris `Dashboard Ristek` menunjuk `https://ristek.sga-cakrawala.org`
yang tidak ada. Dua pilihan, dan ini keputusan kecil yang sebaiknya tidak menunggu Phase 3:

- set `is_active = 0` untuk baris itu sampai dashboard-nya benar-benar ada, sehingga
  `GET /api/v1/me` tidak mengembalikan opsi yang tidak bisa dibuka; atau
- ganti `url`-nya ke target yang nyata.

Membiarkannya berarti ada tombol di panel production yang menghasilkan error DNS.

---

## 5. API Design

### 5.1 Account & Access

Admin BPH/platform only:

| Method | Endpoint | Permission | Fungsi |
|---|---|---|---|
| GET | `/api/v1/admin/divisions` | `accounts.manage` | List divisi |
| POST | `/api/v1/admin/divisions` | `accounts.manage` | Buat divisi |
| PUT | `/api/v1/admin/divisions/:id` | `accounts.manage` | Update divisi |
| GET | `/api/v1/admin/accounts` | `accounts.manage` | List membership/user |
| POST | `/api/v1/admin/accounts` | `accounts.manage` | Buat/invite account |
| PUT | `/api/v1/admin/accounts/:id` | `accounts.manage` | Ubah role/status |

### 5.2 Event Multi-Divisi

| Method | Endpoint | Permission | Perubahan |
|---|---|---|---|
| GET | `/api/v1/admin/events` | `events.read.*` | Return event sesuai scope user. |
| POST | `/api/v1/admin/events` | `events.create.*` | Set `division_id` dari active membership. |
| PUT | `/api/v1/admin/events/:id` | `events.update.*` | Cek owner divisi. |
| DELETE | `/api/v1/admin/events/:id` | `events.delete.*` | V1 hanya platform/BPH jika diaktifkan. |
| POST | `/api/v1/admin/events/:id/publish` | `events.publish.*` | Cek owner divisi. |
| POST | `/api/v1/admin/media` | `media.upload.*` | Simpan ownership media jika media library dibuat. |

Public endpoints:

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/v1/events?division=slug` | List published semua divisi, optional filter divisi. |
| GET | `/api/v1/events/:slug` | Detail published. |
| GET | `/api/v1/events/calendar?month=YYYY-MM&division=slug` | Kalender public. |

### 5.3 QPR

Semua endpoint QPR wajib:

```text
permission: qpr.manage
division slug: bph
```

Divisi lain:

- menu tidak muncul,
- direct API call return 403.

### 5.4 🆕 Form Lintas Divisi

> **Status: desain, belum dibangun.** Contract di bawah mengikuti pola §5.2 (Event) dan
> wrapper `{ success, message, statusCode, data }`. Belum masuk `API.md` — `API.md` baru
> diupdate setelah PRD Form disetujui dan kode ada.

#### Admin

| Method | Endpoint | Permission | Fungsi |
|---|---|---|---|
| GET | `/api/v1/admin/forms` | `forms.read.*` | List form sesuai scope divisi user |
| POST | `/api/v1/admin/forms` | `forms.create.*` | Buat form (selalu `draft`). `division_id` dari active membership |
| GET | `/api/v1/admin/forms/:id` | `forms.read.*` | Detail + fields |
| PUT | `/api/v1/admin/forms/:id` | `forms.update.*` | Update metadata. Cek owner divisi |
| DELETE | `/api/v1/admin/forms/:id` | `forms.delete.*` | Hanya platform/BPH bila diaktifkan |
| POST | `/api/v1/admin/forms/:id/publish` | `forms.publish.*` | `draft` → `published`. Bekukan `form_fields` |
| POST | `/api/v1/admin/forms/:id/close` | `forms.publish.*` | Tutup penerimaan lebih awal |
| GET/PUT/POST/DELETE | `/api/v1/admin/forms/:id/fields` | `forms.update.*` | Kelola field. Ditolak bila form bukan `draft` |
| GET | `/api/v1/admin/forms/:id/submissions` | `forms.submissions.read.*` | Rekap + daftar respons |
| GET | `/api/v1/admin/forms/:id/submissions/:sid` | `forms.submissions.read.*` | Detail satu respons + lampiran |
| GET | `/api/v1/admin/forms/:id/export` | `forms.submissions.read.*` | Ekspor CSV |

#### Publik

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/v1/forms?division=slug` | List form `published` dan sedang dalam periode buka |
| GET | `/api/v1/forms/:slug` | Skema form untuk render di FE — hanya field yang perlu dilihat pengisi |
| POST | `/api/v1/forms/:slug/submissions` | Kirim jawaban. `multipart/form-data` bila ada lampiran |

#### Aturan endpoint publik

Mengikuti `CONTEXT.md` §6 dan hardening yang sudah terbukti di Advokasi:

- **Read-only.** Tidak ada endpoint publik yang mengubah data admin.
- **Hanya `published` + dalam jendela buka.** Di luar itu return **404, bukan 403** —
  keberadaan form yang belum rilis atau sudah ditutup tidak boleh bocor.
- Jendela buka–tutup **dihitung server** dari `opens_at_ms` / `closes_at_ms` (Asia/Jakarta).
  FE tidak boleh menyimpulkan sendiri.
- **Skema dibaca ulang dari DB pada setiap POST** dan seluruh payload divalidasi ulang di
  server. Pilihan jawaban tidak boleh bisa dipalsukan dari client — nilai yang diterima
  harus ada di `form_fields.config`.
- Jawaban untuk field yang tidak ada di skema → tolak seluruh submission, bukan diam-diam
  dibuang.
- Honeypot field + rate limit per IP per form (ikuti pola binding `RATE_LIMITER` yang
  sudah ada, 60 req/60s).
- CORS exact allow-list dari `env.CORS_ORIGIN`, bukan `*`.
- Lampiran: batasi jumlah, ukuran, dan ekstensi lewat allowlist eksplisit. Nama file di R2
  diacak. `original_filename` tidak pernah dipakai sebagai path.
- Pesan error internal tidak dikirim ke client. Validation error = **422** dengan
  `errors: { field: [msg] }` — sama seperti event, bukan 400.
- Pagination list publik: `{ current_page, total, per_page }` — contract SDD menang atas
  helper `@internal/shared`.

#### Batas yang tidak boleh dilewati

- Endpoint form Hub **tidak** menerima submission untuk campaign Advokasi, dan sebaliknya.
  Dua sistem, dua DB, dua kontrak.
- Hub **tidak** mem-proxy `POST /api/v1/reports`. Kontrak itu 1:1 Laravel dan milik
  Advokasi.
- URL publik form Hub memakai domain Hub, bukan `sga-cakrawala.org/student-voice/*` —
  path itu milik Advokasi dan QR-nya sudah tercetak.

---

## 6. Panel Design

### 6.1 Login

Setelah login:

1. simpan token,
2. call `/api/v1/me`,
3. jika `workspace_options.length > 1`, tampilkan Select Workspace,
4. jika tidak, masuk Dashboard Terpadu.

### 6.2 Sidebar Menu

Sidebar dibentuk dari permission:

| Menu | Permission |
|---|---|
| Ringkasan | any active membership |
| Event | `events.read.*` |
| Kalender | `events.read.*` |
| 🆕 Form | `forms.read.*` |
| QPR | `qpr.manage` |
| Akun & Akses | `accounts.manage` |
| Audit Log | `audit.read` |

🆕 Di dalam menu Form, tombol aksi di-gate terpisah dari visibility menu — pola yang
sudah dipakai Event:

| Aksi di UI | Permission |
|---|---|
| Buat form | `forms.create.*` |
| Edit form / kelola field | `forms.update.*` |
| Publish / close | `forms.publish.*` |
| Lihat respons & rekap | `forms.submissions.read.*` |
| Hapus | `forms.delete.*` |

Contributor melihat menu Form dan bisa membuat draft, tapi **tidak** melihat tombol
Publish dan tidak melihat tab Respons. Menyembunyikan tombol saja tidak cukup —
backend tetap wajib menolak (§4.4).

### 6.3 Select Workspace

Untuk Ristek dan Advokasi:

```text
Pilih dashboard

[Dashboard Terpadu]
Kelola event lintas SGA dari satu tempat.

[Dashboard Ristek / Advokasi]
Buka dashboard khusus divisi.
```

External dashboard dibuka dengan redirect aman. Jangan kirim password via query string.

**Status implementasi 10 Sep 2026 (commit `c485574`, live di production):** modal sudah
dibangun (`panel/src/components/WorkspaceModal.jsx`) dan ter-seed di production, dan
`handleSelectWorkspace` (`panel/src/App.jsx:96-118`) **sudah memakai handoff** — bukan lagi
`window.location.href = ws.url` telanjang. Untuk `external_dashboard` panel memanggil
`requestWorkspaceHandoff(ws.id)` lalu pindah ke `data.redirect_to` yang dibalas backend;
modal tetap terbuka sampai berhasil supaya pesan error punya tempat tampil (`setWsBusy` /
`setWsErr`). Desain lengkapnya ada di §4.5.

Dua hal yang dulu tercatat perlu diberesi, sekarang **sudah beres**:

- ~~`handleSelectWorkspace` hanya menangani `kind === "external_dashboard"`; untuk `cms_hub`
  modal sekadar ditutup tanpa aksi eksplisit~~ → cabang `cms_hub` sekarang eksplisit
  (`App.jsx:100-104`, dengan komentar alasannya): tutup modal dan jatuh ke `<Routes>`.
- ~~Baris `workspace_options` dengan `url` yang tidak resolve
  (`https://ristek.sga-cakrawala.org`) masih dikembalikan `/api/v1/me`~~ → sudah di-set
  `is_active = 0` langsung di D1 production 10 Sep 2026, dan `/api/v1/me` memfilter
  `is_active`. Dijaga test `src/handoff.test.ts` §"Filter is_active di /api/v1/me".

Yang **masih** menahan handoff benar-benar dipakai end-to-end (semuanya di luar repo ini):

- Route `/sso` di `AdvocationDashboard` **sudah ditulis tapi untracked, belum di-deploy**
  (production `satgas.sga-cakrawala.org/sso` → 404), dan punya **bug kontrak** yang
  menggagalkan handoff 100% — detail & bukti di §4.5. Itu pekerjaan repo terpisah.
- `HANDOFF_SHARED_SECRET` belum di-set di production, jadi endpoint exchange fail-closed
  `503` (§4.5).

---

## 7. Migration Plan

1. Buat migration `divisions`, `cms_memberships`, `workspace_options`, `audit_logs`.
2. Seed divisi awal.
3. Tambahkan kolom ownership ke `events`.
4. Set semua event existing ke divisi BPH.
5. Tambah endpoint `/me`.
6. Ganti `requireRole("admin")` bertahap menjadi `requirePermission`.
7. Update panel sidebar berdasarkan permissions.
8. Update create event agar mengisi `division_id`.
9. Update list admin agar scoped by division.
10. Tambah tests untuk akses lintas divisi.

**Status 10 Sep 2026: langkah 1–10 selesai dan sudah live di production** (deploy 9 Sep
2026, migration `0001_watery_skreet.sql`). Lihat `PRODUCTION-READINESS-2026-09-09.md`.

Langkah lanjutan untuk keputusan 10 Sep 2026:

**Phase 3 — One Identity (D-A):**

11. Inventarisasi baris `User` di D1 AdvocationDashboard; cocokkan tiap email dengan akun
    di auth service. Catat yang belum ada padanannya.
12. Buat akun auth service untuk yang belum terdaftar, **sebelum** auth lokal dimatikan.
13. Tambah binding `AUTH_SERVICE` di `AdvocationDashboard/wrangler.jsonc`.
14. Ganti validasi sesi Advokasi ke `AUTH_SERVICE`. Jalankan **dual-accept** dulu: terima
    auth lokal ATAU auth service.
15. Ganti sumber nilai `created_by`/`updated_by`/`deleted_by` ke nama dari profil auth
    service. Jangan tulis ulang nilai historis.
16. Verifikasi tidak ada admin yang terkunci keluar, baru cabut auth lokal: hapus
    `model User`, `model PasswordResetToken`, halaman `(auth)/*`, bcryptjs, rate limit
    login, throttle ganti password, dan fitur hapus akun di settings.
17. ✅ **Selesai 10 Sep 2026 (commit `c485574`).** `panel/src/App.jsx:96-118` sudah
    memakai handoff one-time code, bukan redirect telanjang (§4.5).
18. ✅ **Selesai 10 Sep 2026.** `workspace_options` baris `Dashboard Ristek` sudah di-set
    `is_active = 0` langsung di D1 production (sengaja bukan lewat migration supaya tidak
    memicu deploy penuh). `/api/v1/me` memfilter `is_active`, jadi opsinya tidak muncul.
18b. Set `HANDOFF_SHARED_SECRET` via `wrangler secret put` di Worker Hub **dan** Worker
    Advokasi. **Belum dikerjakan** — diverifikasi 11 Sep 2026 `wrangler secret list` masih
    `[]`, jadi endpoint exchange fail-closed `503`.

**Phase 6 — Modul Form (D-B), setelah PRD Form disetujui:**

19. Migration `forms`, `form_fields`, `form_submissions`, `form_answers`, `form_files`.
20. Tambah permission `forms.*` ke `ROLE_PERMISSIONS` (§3.3).
21. Modul `src/modules/forms/` — admin CRUD + publish/close + fields.
22. Endpoint publik form + hardening (§5.4).
23. Upload lampiran ke prefix `forms/` di bucket `bph-cms-media` yang sudah ada.
24. Panel: menu Form + gate tombol per permission (§6.2).
25. Tests lintas divisi untuk form (§8).

---

## 8. Testing

Minimal test cases:

**Sudah ada (live):**

- BPH bisa melihat QPR.
- Ristek tidak melihat QPR dan API QPR return 403.
- UKM bisa create event UKM.
- UKM tidak bisa edit event Media.
- Ristek melihat Select Workspace.
- Advokasi melihat Select Workspace.
- Event public tetap menampilkan semua published event.
- Draft tidak bocor di public endpoint.
- Audit log tercatat saat publish/unpublish.

**🆕 Phase 3 — One Identity (D-A):**

- Admin Advokasi yang sudah ada **tetap bisa masuk** selama jendela dual-accept.
- Admin Advokasi masuk lewat sesi auth service **tanpa** melihat halaman login.
- Setelah auth lokal dicabut: JWT Auth.js lama ditolak, bukan diterima diam-diam.
- `created_by` untuk aksi baru berisi nama dari auth service; nilai historis **tidak berubah**.
- Pilih "Dashboard Advokasi" dari Hub → tiba dalam keadaan sudah login (bukan `307 → /login`).
- Pilih "Dashboard Terpadu" → tetap di Hub, tidak ada redirect.
- `workspace_options` dengan `is_active = 0` **tidak** dikembalikan `/api/v1/me`.
- Tidak ada token atau kredensial yang muncul di query string saat handoff.

**🆕 Phase 6 — Modul Form (D-B):**

- UKM bisa buat form UKM; UKM tidak bisa edit form Media.
- UKM tidak bisa baca submission form Media (403), dan tidak bisa menebak `submission_id`.
- Contributor bisa buat draft form, **tidak** bisa publish, dan **tidak** bisa baca respons.
- Viewer tidak melihat tombol create/edit sama sekali.
- Form `draft` dan `closed` di endpoint publik → **404**, bukan 403.
- Form di luar jendela buka–tutup → ditolak server meski FE-nya mencoba mengirim.
- Payload dengan nilai pilihan yang tidak ada di `form_fields.config` → **ditolak** (422),
  bukan disimpan.
- Payload berisi field yang tidak ada di skema → seluruh submission ditolak.
- Edit `form_fields` setelah ada submission → ditolak.
- Insert submission yang gagal di tengah → objek R2 dan baris yang sudah masuk
  **ter-cleanup** (tidak ada submission yatim, tidak ada file yatim).
- `fingerprint_hash` tidak pernah tersimpan atau terkirim dalam bentuk plaintext.
- Submission anonim → `respondent_name`/`respondent_email` NULL dan tidak tampil di panel.
- Upload lampiran: ekstensi di luar allowlist ditolak; `original_filename` berisi path
  traversal tidak mempengaruhi `r2_key`.
- Endpoint form Hub **tidak** bisa dipakai untuk menulis ke campaign Advokasi.

---

## 9. Rollout

> Penomoran fase yang authoritative ada di **PRD §8**. Bagian ini hanya catatan urutan
> teknis dan sudah diselaraskan ke sana per 10 Sep 2026.

| PRD §8 | Isi | Status |
|---|---|---|
| Phase 1 | Access Foundation — schema, seed divisi, membership BPH/Ristek, `/me`, feature gate | ✅ live 9 Sep 2026 |
| Phase 2 | Ownership event + scoped query + endpoint publik gabungan | ⚠️ backend live; **6 divisi sudah punya akun + membership** (10 Sep 2026, diverifikasi ulang 11 Sep). Sisa: membership Ristek, memindahkan BPH off bootstrap, dan rotasi password |
| Phase 3 | 🆕 One Identity (D-A) — Advokasi pindah ke auth service + handoff sesi nyata | 🟡 **sisi Hub live 10 Sep 2026** (`c485574`): `workspace_handoffs`, 2 endpoint, panel. Sisi Advokasi: route `/sso` **sudah ditulis tapi untracked & belum di-deploy** (`satgas…/sso` → 404) dan **punya bug kontrak yang menggagalkan handoff 100%** (§4.5). D-A sendiri belum dimulai — route itu masih memetakan email ke `model User` lokal. `HANDOFF_SHARED_SECRET` belum dipasang |
| Phase 4 | 🆕 Sambungkan event ke `sga-landing-page` (KR4) | 🟡 kode selesai di repo lain, **belum di-commit & belum di-deploy** |
| Phase 5 | Account & Access Management | ❌ belum |
| Phase 6 | 🆕 Modul Form lintas divisi (D-B) | ❌ blocked — butuh PRD Form disetujui |
| Phase 7 | QPR BPH-only | ❌ blocked — `QPR-PRD.md` masih draft, nunggu konfirmasi BPH |
| Phase 8 | Workflow & future modules | ❌ belum |

**Urutan Phase 3 / Phase 4 / Phase 6 relatif satu sama lain belum diputuskan** (D-D).
Yang mengikat hanya: Phase 5 butuh adopsi Phase 2 beres, dan Phase 6 butuh PRD Form.

**Step 4 versi lama ("buat akun divisi lain") adalah penghambat nyata Phase 2** dan
bukan kerja kode. Checklist-nya ada di `ACCOUNTS-ACCESS.md` §7 dan
`PRODUCTION-READINESS-2026-09-09.md` §10.

---

## 10. Risiko

| Risiko | Mitigasi |
|---|---|
| Salah scope, user bisa edit event divisi lain | Object-level authorization wajib di setiap endpoint mutasi. Berlaku sama untuk `forms.*` dan submission — cek owner dari **induk**, bukan dari baris anak. |
| Menu disembunyikan tapi API masih bisa diakses | Backend deny-by-default. |
| Password akun divisi bocor | Jangan simpan password produksi di repo. Pakai reset/temporary flow. **Catatan 10 Sep 2026:** `docs/DIVISION-ACCOUNTS.md` dan `docs/ACCOUNTS-ACCESS.md` memuat temporary password berpola deterministic di repo yang **public** (`Ristek-CU/bph-cms`). Belum ada keputusan tentang ini. |
| Shared account membuat audit tidak jelas | Rekomendasi akun personal per pengurus setelah fase awal. |
| External dashboard login berat | Gunakan auth shared/token handoff aman, bukan login ulang dengan password di URL. Desainnya di §4.5. |
| 🆕 **Admin Advokasi terkunci keluar** saat peralihan auth | Jendela **dual-accept** (auth lokal ATAU auth service) wajib ada sebelum auth lokal dicabut. Inventarisasi dan cocokkan semua email user existing **lebih dulu**. Jangan switch sekali jalan. |
| 🆕 **Riwayat audit Advokasi rusak** | `created_by`/`updated_by`/`deleted_by` menyimpan nama sebagai string bebas. Nilai historis tidak ditulis ulang — menulis ulang = memalsukan riwayat. |
| 🆕 **Dua form builder divergen** | Konsekuensi D-B yang diterima sadar (PRD §1.4). Perlu pemilik yang jelas untuk masing-masing, dan catatan eksplisit di kedua PRD supaya divisi tidak bingung harus bikin form di mana. |
| 🆕 **Fitur menggantung** | ~~`workspace_options` menunjuk `https://ristek.sga-cakrawala.org` yang tidak resolve~~ → **sudah diberesi** 10 Sep 2026 (`is_active = 0`, diverifikasi ulang 11 Sep). Risikonya sekarang berpindah bentuk: **handoff setengah jalan**. Sisi Hub live dan menerbitkan kode; sisi Advokasi sudah ditulis tapi untracked, belum di-deploy (`satgas…/sso` → 404), dan punya bug kontrak yang menggagalkan 100% (§4.5). Memilih "Dashboard Advokasi" dari panel production menghasilkan redirect ke `/sso?code=…` yang menjawab **404** — **terlihat selesai padahal tidak**, dan kodenya hangus terpakai. Jangan sosialisasikan tombolnya sampai sisi Advokasi di-deploy dan bug kontraknya beres |
| 🆕 **Kontrak SSO tidak diuji lintas repo** | Bug kontrak §4.5 lolos karena Hub punya 24 test yang hijau dan benar, sementara sisi Advokasi **tidak punya test sso sama sekali** — tidak ada yang menguji kedua sisi terhadap kontrak yang sama. Selama wrapper `{ success, message, statusCode, data }` hanya didokumentasikan dan tidak diuji bersama, celah jenis ini akan muncul lagi di setiap konsumen baru |
| 🆕 **Data pribadi responden** | Modul Form menyimpan jawaban mahasiswa, mungkin termasuk identitas dan lampiran. Kebijakan retensi dan anonimitas **harus dijawab di PRD Form sebelum modul dipakai**, bukan setelah ada insiden. |
| 🆕 **Menumpuk modul di atas sambungan yang belum tertutup** | KR4 (landing page baca event) dan adopsi Phase 2 (akun divisi) keduanya belum beres. Membangun Phase 6 di atasnya menambah permukaan yang belum terpakai. Ini risiko urutan (D-D), dicatat sadar bukan diabaikan. |
| 🆕 **Password 6 akun divisi ada di git history** | `docs/DIVISION-ACCOUNTS.md` memuat password berpola deterministic dan repo ini **public** (`Ristek-CU/bph-cms`). Siapa pun dengan akses repo bisa login sebagai divisi mana pun. Diperparah: **belum ada endpoint suspend/revoke membership**, jadi pencabutan hanya bisa lewat update `status` langsung di D1. Rotasi adalah prioritas tertinggi — `PRODUCTION-READINESS-2026-09-10.md` §6.4 |
| ✅ **Backup D1** — *sudah tertutup* | ~~Official D1 export gagal (`Authentication error code 10000`)~~ → percobaan 10 Sep 2026 **berhasil**: `backups/pre-rate-limit-2026-09-10.sql` (6 tabel + 19 INSERT, diambil sebelum migration `0002`). `backups/` di-gitignore. **Tetap ambil restore point baru sebelum setiap migration berikutnya** — dump itu sudah tidak memuat `workspace_handoffs` maupun 6 baris membership |
