#!/usr/bin/env bash
# E2E endpoint test untuk bph-cms (jalankan dengan auth worker + bph-cms dev hidup).
# Pakai: bash scripts/e2e-test.sh [BASE_URL]
set -u
BASE="${1:-http://localhost:8791}"
EMAIL="testadmin-e2e@sga.test"
PASS="password123"
PASS_SUM=0; FAIL_SUM=0
# Tanggal event 30 hari ke depan — status selalu "upcoming", tidak tergantung hari operasi test.
EDATE=$(date -v+30d +%Y-%m-%d 2>/dev/null || date -d "+30 days" +%Y-%m-%d)
EMONTH=$(date -v+30d +%Y-%m 2>/dev/null || date -d "+30 days" +%Y-%m)

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
CREATE=$(curl -s -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"title\": \"E2E Test Event\",
  \"starts_at\": \"${EDATE}T08:00:00+07:00\",
  \"ends_at\": \"${EDATE}T17:00:00+07:00\",
  \"location\": \"Aula E2E\",
  \"sessions\": [
    {\"name\": \"Sesi 1\", \"starts_at\": \"${EDATE}T08:00:00+07:00\", \"ends_at\": \"${EDATE}T10:00:00+07:00\"},
    {\"name\": \"Sesi 2\", \"starts_at\": \"${EDATE}T13:00:00+07:00\", \"ends_at\": \"${EDATE}T15:00:00+07:00\", \"speaker\": \"Pak Test\", \"location\": \"Ruang B\"}
  ]}")
EID=$(jqget "$CREATE" "d['data']['id']")
SLUG=$(jqget "$CREATE" "d['data']['slug']")
[ -n "$EID" ] && [ "$EID" != "None" ] && check "create event id" 1 1 || { check "create event id" 1 0; echo "$CREATE"; }
check "slug auto" "e2e-test-event" "$SLUG"

echo "== 4. Validasi 422 =="
V1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d "{\"starts_at\":\"${EDATE}T08:00:00+07:00\",\"ends_at\":\"${EDATE}T07:00:00+07:00\",\"location\":\"X\"}")
check "ends < starts ditolak" 422 "$V1"
V2=$(curl -s -X POST "$BASE/api/v1/admin/events" -H "$AUTH" -H "Content-Type: application/json" -d "{\"title\":\"Sesi luar rentang\",\"starts_at\":\"${EDATE}T08:00:00+07:00\",\"ends_at\":\"${EDATE}T17:00:00+07:00\",\"location\":\"X\",\"sessions\":[{\"name\":\"OOR\",\"starts_at\":\"${EDATE}T18:00:00+07:00\",\"ends_at\":\"${EDATE}T19:00:00+07:00\"}]}")
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
CAL=$(curl -s "$BASE/api/v1/events/calendar?month=$EMONTH")
check "calendar memuat" "1" "$(jqget "$CAL" "sum(1 for i in d['data']['items'] if i['slug']=='$SLUG')")"
check "calendar bulan kosong" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/calendar?month=2030-01")"
check "calendar format salah" 422 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/calendar?month=sep-2030")"

echo "== 7. Update + add session + reorder =="
curl -s -o /dev/null -X PUT "$BASE/api/v1/admin/events/$EID" -H "$AUTH" -H "Content-Type: application/json" -d '{"organizer":"Tim E2E","registration_url":"https://forms.gle/test"}'
DET2=$(curl -s "$BASE/api/v1/events/$SLUG")
check "update organizer" "Tim E2E" "$(jqget "$DET2" "d['data']['organizer']")"
S3=$(curl -s -X POST "$BASE/api/v1/admin/events/$EID/sessions" -H "$AUTH" -H "Content-Type: application/json" -d "{\"name\":\"Sesi 3\",\"starts_at\":\"${EDATE}T15:00:00+07:00\",\"ends_at\":\"${EDATE}T16:30:00+07:00\"}")
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

echo "== 10. Form: CRUD + reserved slug + kontrak publik (landing page) =="
FRES=$(curl -s -X POST "$BASE/api/v1/admin/forms" -H "$AUTH" -H "Content-Type: application/json" -d '{"title":"E2E Polling","slug":"student-voice"}')
check "slug student-voice ditolak 422" 422 "$(jqget "$FRES" "d['statusCode']")"
FC=$(curl -s -X POST "$BASE/api/v1/admin/forms" -H "$AUTH" -H "Content-Type: application/json" -d '{"title":"E2E Polling","fields":[{"label":"Pilih","type":"multiple_choice","required":true,"options":["A","B"],"sort_order":0}]}')
FID=$(jqget "$FC" "d['data']['id']")
FSLUG=$(jqget "$FC" "d['data']['slug']")
[ -n "$FID" ] && [ "$FID" != "None" ] && check "form dibuat" 1 1 || { check "form dibuat" 1 0; echo "$FC"; }
check "form status draft" "draft" "$(jqget "$FC" "d['data']['status']")"
check "form draft publik 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/forms/$FSLUG")"
curl -s -o /dev/null -X POST "$BASE/api/v1/admin/forms/$FID/publish" -H "$AUTH"
FPUB=$(curl -s "$BASE/api/v1/forms/$FSLUG")
# Kontrak landing page (CampaignSchema): slug/title/status/isOpen/opensAt/closesAt/fields[].options array.
check "kontrak isOpen" "True" "$(jqget "$FPUB" "d['data']['isOpen']")"
check "kontrak opensAt null" "None" "$(jqget "$FPUB" "d['data']['opensAt']")"
check "kontrak options array" "['A', 'B']" "$(jqget "$FPUB" "d['data']['fields'][0]['options']")"
check "kontrak hint terisi" 1 "$(jqget "$FPUB" "len(d['data']['fields'][0]['hint']) > 0" | sed 's/True/1/')"
FPID=$(jqget "$FPUB" "d['data']['fields'][0]['id']")
SUB=$(curl -s -X POST "$BASE/api/v1/forms/$FSLUG" -F "field_${FPID}=A" -F "_website=")
check "submit publik 201" 201 "$(jqget "$SUB" "d['statusCode']")"
FSUBS=$(curl -s "$BASE/api/v1/admin/forms/$FID/submissions" -H "$AUTH")
check "submission masuk" "1" "$(jqget "$FSUBS" "d['data']['meta']['total']")"
FAN=$(curl -s "$BASE/api/v1/admin/forms/$FID/analytics" -H "$AUTH")
check "analytics distribusi A" "1" "$(jqget "$FAN" "d['data']['fields'][0]['distribution']['A']")"
curl -s -o /dev/null -X POST "$BASE/api/v1/admin/forms/$FID/close" -H "$AUTH"
check "closed menolak respons" 409 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/forms/$FSLUG" -F "field_${FPID}=B")"
check "form dengan respons tidak bisa dihapus" 409 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/admin/forms/$FID" -H "$AUTH")"
SID=$(jqget "$FSUBS" "d['data']['items'][0]['id']")
curl -s -o /dev/null -X DELETE "$BASE/api/v1/admin/forms/submissions/$SID" -H "$AUTH"
DEL_F=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/admin/forms/$FID" -H "$AUTH")
check "form cleanup 200" 200 "$DEL_F"

echo "== 11. Cleanup + 404 setelah delete =="
DEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/admin/events/$EID" -H "$AUTH")
check "delete 200" 200 "$DEL"
check "detail setelah delete 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/$SLUG")"

echo
echo "== HASIL: $PASS_SUM pass, $FAIL_SUM fail =="
[ "$FAIL_SUM" = "0" ]
