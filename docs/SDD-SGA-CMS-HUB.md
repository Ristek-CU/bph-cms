# SDD — SGA CMS Hub Multi-Divisi

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Status:** Draft teknis
**Scope:** Multi-division access, account provisioning, event ownership, special workspace routing
**Terkait:** [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md), [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md), [SDD.md](./SDD.md)

---

## 1. Tujuan Desain

Repo ini berubah arah dari CMS BPH menjadi **SGA CMS Hub**. Tujuan teknisnya:

- satu dashboard untuk semua divisi,
- akun per divisi,
- fitur dibuka sesuai permission,
- Event bisa dipakai semua divisi,
- QPR tetap khusus BPH,
- Ristek dan Advokasi bisa memilih Dashboard Terpadu atau dashboard khusus milik mereka.

Desain ini tidak mengganti auth utama. Auth tetap memakai service `sga-superapp-auth`. CMS Hub hanya menyimpan membership, permission, ownership data, dan audit log.

---

## 2. Prinsip Arsitektur

| Prinsip | Keputusan |
|---|---|
| Auth source | Tetap `AUTH_SERVICE`, jangan buat password table di CMS Hub. |
| Access model | Role + permission + division scope. |
| Default access | Deny by default. |
| Event ownership | Setiap event punya `division_id`. |
| QPR | Permission khusus BPH: `qpr.manage`. |
| Special workspace | Ristek dan Advokasi punya opsi redirect ke dashboard khusus. |
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
    "qpr.manage",
    "accounts.manage",
    "audit.read",
  ],
  division_admin: [
    "events.read.own_division",
    "events.create.own_division",
    "events.update.own_division",
    "events.publish.own_division",
    "media.upload.own_division",
  ],
  contributor: [
    "events.read.own_division",
    "events.create_draft.own_division",
    "events.update_draft.own_division",
    "media.upload.own_division",
  ],
  viewer: [
    "events.read.own_division",
  ],
};
```

Catatan implementasi v1:

- `events.create_draft.own_division` boleh memakai endpoint create event karena event baru selalu dibuat sebagai draft.
- `events.update_draft.own_division` hanya boleh mengubah event milik divisinya ketika status event masih `draft`.
- Contributor tidak punya `events.publish.*` dan `events.delete.*`.

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
| QPR | `qpr.manage` |
| Akun & Akses | `accounts.manage` |
| Audit Log | `audit.read` |

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

---

## 8. Testing

Minimal test cases:

- BPH bisa melihat QPR.
- Ristek tidak melihat QPR dan API QPR return 403.
- UKM bisa create event UKM.
- UKM tidak bisa edit event Media.
- Ristek melihat Select Workspace.
- Advokasi melihat Select Workspace.
- Event public tetap menampilkan semua published event.
- Draft tidak bocor di public endpoint.
- Audit log tercatat saat publish/unpublish.

---

## 9. Rollout

### Step 1

Deploy schema + seed divisi + membership BPH/Ristek.

### Step 2

Aktifkan `/me` dan feature gate panel, tetapi event masih bisa dikelola seperti sekarang.

### Step 3

Aktifkan ownership event dan scoped query.

### Step 4

Buat akun divisi lain.

### Step 5

Aktifkan special workspace untuk Ristek dan Advokasi.

### Step 6

Bangun QPR BPH-only.

---

## 10. Risiko

| Risiko | Mitigasi |
|---|---|
| Salah scope, user bisa edit event divisi lain | Object-level authorization wajib di setiap endpoint mutasi. |
| Menu disembunyikan tapi API masih bisa diakses | Backend deny-by-default. |
| Password akun divisi bocor | Jangan simpan password produksi di repo. Pakai reset/temporary flow. |
| Shared account membuat audit tidak jelas | Rekomendasi akun personal per pengurus setelah fase awal. |
| External dashboard login berat | Gunakan auth shared/token handoff aman, bukan login ulang dengan password di URL. |
