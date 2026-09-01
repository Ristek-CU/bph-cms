#!/usr/bin/env bash
# E2E endpoint test untuk bph-cms (jalankan dengan auth worker + bph-cms dev hidup).
# Pakai: bash scripts/e2e-test.sh [BASE_URL]
set -u
BASE="${1:-http://localhost:8791}"
EMAIL="testadmin-e2e@sga.test"
PASS="password123"
PASS_SUM=0; FAIL_SUM=0

check() { # nama expect actual
  local name="$1" expect="$2" got="$3"
  if [ "$expect" = "$got" ]; then PASS_SUM=$((PASS_SUM+1)); echo "ok   $name ($got)";
  else FAIL_SUM=$((FAIL_SUM+1)); echo "FAIL $name — expect $expect got $got"; fi
}

jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$2" <<<"$1" 2>/dev/null; }

echo "== 1. Login (proxy sign-in) =="
LOGIN=$(curl -s -X POST "$BASE/api/v1/auth/sign-in" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(jqget "$LOGIN" "d['data']['token']")
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] && check "sign-in token" 1 1 || check "sign-in token" 1 0
ROLE=$(jqget "$LOGIN" "d['data']['user']['role']")
check "role admin" "admin" "$ROLE"
AUTH="Authorization: Bearer $TOKEN"

echo "== 2. Guard: tanpa token =="
check "POST /admin/events tanpa auth" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/events" -H 'Content-Type: application/json' -d '{}')"
check "GET /admin/events tanpa auth" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/admin/events")"

echo "== 3. Buat event + sessions inline =="
CREATE=$(curl -s -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d '{
  "title": "E2E Test Event",
  "starts_at": "2026-09-15T08:00:00+07:00",
  "ends_at": "2026-09-15T17:00:00+07:00",
  "location": "Aula E2E",
  "sessions": [
    {"name": "Sesi 1", "starts_at": "2026-09-15T08:00:00+07:00", "ends_at": "2026-09-15T10:00:00+07:00"},
    {"name": "Sesi 2", "starts_at": "2026-09-15T13:00:00+07:00", "ends_at": "2026-09-15T15:00:00+07:00", "speaker": "Pak Test", "location": "Ruang B"}
  ]}')
EID=$(jqget "$CREATE" "d['data']['id']")
SLUG=$(jqget "$CREATE" "d['data']['slug']")
[ -n "$EID" ] && [ "$EID" != "None" ] && check "create event id" 1 1 || { check "create event id" 1 0; echo "$CREATE"; }
check "slug auto" "e2e-test-event" "$SLUG"

echo "== 4. Validasi 422 =="
V1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d '{"starts_at":"2026-09-15T08:00:00+07:00","ends_at":"2026-09-15T07:00:00+07:00","location":"X"}')
check "ends < starts ditolak" 422 "$V1"
V2=$(curl -s -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d '{"title":"Sesi luar rentang","starts_at":"2026-09-15T08:00:00+07:00","ends_at":"2026-09-15T17:00:00+07:00","location":"X","sessions":[{"name":"OOR","starts_at":"2026-09-15T18:00:00+07:00","ends_at":"2026-09-15T19:00:00+07:00"}]}')
check "sesi di luar rentang ditolak" 422 "$(jqget "$V2" "d['statusCode']")"
check "field error sessions.0" "['Session must be within the event time range']" "$(jqget "$V2" "d['errors']['sessions.0']")"

echo "== 5. Draft tidak bocor =="
check "detail draft 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/$SLUG")"

echo "== 6. Publish lalu publik =="
curl -s -o /dev/null -X POST "$BASE/api/v1/admin/events/$EID/publish" -H "$AUTH"
check "detail published 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/$SLUG")"
DET=$(curl -s "$BASE/api/v1/events/$SLUG")
check "detail 2 sessions" "2" "$(jqget "$DET" "len(d['data']['sessions'])")"
check "status upcoming" "upcoming" "$(jqget "$DET" "d['data']['status']")"
LIST=$(curl -s "$BASE/api/v1/events?status=upcoming&limit=50")
check "list upcoming memuat" "1" "$(jqget "$LIST" "sum(1 for i in d['data']['items'] if i['slug']=='$SLUG')")"
check "meta per_page" "50" "$(jqget "$LIST" "d['data']['meta']['per_page']")"
CAL=$(curl -s "$BASE/api/v1/events/calendar?month=2026-09")
check "calendar memuat" "1" "$(jqget "$CAL" "sum(1 for i in d['data']['items'] if i['slug']=='$SLUG')")"
check "calendar bulan kosong" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/calendar?month=2027-01")"
check "calendar format salah" 422 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/calendar?month=sep-2026")"

echo "== 7. Update + add session + reorder =="
curl -s -o /dev/null -X PUT "$BASE/api/v1/admin/events/$EID" -H "$AUTH" -H "Content-Type: application/json" -d '{"organizer":"Tim E2E","registration_url":"https://forms.gle/test"}'
DET2=$(curl -s "$BASE/api/v1/events/$SLUG")
check "update organizer" "Tim E2E" "$(jqget "$DET2" "d['data']['organizer']")"
S3=$(curl -s -X POST "$BASE/api/v1/admin/events/$EID/sessions" -H "$AUTH" -H "Content-Type: application/json" -d '{"name":"Sesi 3","starts_at":"2026-09-15T15:00:00+07:00","ends_at":"2026-09-15T16:30:00+07:00"}')
S3ID=$(jqget "$S3" "d['data']['sessions'][2]['id']")
check "detail kini 3 sessions" "3" "$(jqget "$S3" "len(d['data']['sessions'])")"
ORD=$(curl -s -X PUT "$BASE/api/v1/admin/events/$EID/sessions/order" -H "$AUTH" -H "Content-Type: application/json" -d '{"session_ids":["00000000-0000-7000-8000-000000000000"]}')
check "reorder id asing ditolak" 422 "$(jqget "$ORD" "d['statusCode']")"

echo "== 8. Upload media =="
printf '\x89PNG\r\n\x1a\n' > /tmp/e2e-cover.png; head -c 2000 /dev/urandom >> /tmp/e2e-cover.png
UP=$(curl -s -X POST "$BASE/api/v1/admin/media" -H "$AUTH" -F "file=@/tmp/e2e-cover.png;type=image/png")
CURL_=$(jqget "$UP" "d['data']['url']")
case "$CURL_" in *"/storage/covers/"*) check "upload url" 1 1;; *) check "upload url" 1 0; echo "$UP";; esac
cp /tmp/e2e-cover.png /tmp/e2e-notimage.bin 2>/dev/null
BADTYPE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/media" -H "$AUTH" -F 'file=@/tmp/e2e-notimage.bin;type=text/plain')
# 000 = wrangler sedang reload file saat test jalan — ulangi sekali.
[ "$BADTYPE" = "000" ] && BADTYPE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/media" -H "$AUTH" -F 'file=@/tmp/e2e-notimage.bin;type=text/plain')
check "file bukan gambar ditolak" 422 "$BADTYPE"
KEY="${CURL_##*/storage/}"
check "storage serve 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/storage/$KEY")"

echo "== 9. Unpublish → draft 404 lagi =="
curl -s -o /dev/null -X POST "$BASE/api/v1/admin/events/$EID/unpublish" -H "$AUTH"
check "detail setelah unpublish 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/$SLUG")"
# publish balik supaya cleanup via public slug possible
curl -s -o /dev/null -X POST "$BASE/api/v1/admin/events/$EID/publish" -H "$AUTH"

echo "== 10. Cleanup + 404 setelah delete =="
DEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/admin/events/$EID" -H "$AUTH")
check "delete 200" 200 "$DEL"
check "detail setelah delete 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/$SLUG")"

echo
echo "== HASIL: $PASS_SUM pass, $FAIL_SUM fail =="
[ "$FAIL_SUM" = "0" ]
