#!/bin/bash
# Verifies the demo seeder and that the new UI elements actually render.
set -u
cd /app || exit 1

if ! command -v curl > /dev/null 2>&1; then
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq curl > /dev/null 2>&1
fi

export SESSION_SECRET="verify-secret-long-enough-abcdefghijklmnop-1234567890"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="VerifyAdminPass123!"
export PORT=4040
export DATA_DIR=/app/data

rm -rf /app/data
mkdir -p /app/data

echo "=== npm install ==="
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

echo
echo "=== run seeder ==="
node scripts/seed-demo.js 2>&1 | tail -20

echo
echo "=== counts after seed ==="
node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
const q=(s2)=>new Promise(r=>d.get(s2,(e,x)=>r(x?x.c:'ERR')));
(async()=>{
  console.log('users      ', await q('SELECT COUNT(*) c FROM users WHERE is_admin=0'));
  console.log('apps       ', await q('SELECT COUNT(*) c FROM apps'));
  console.log('grants     ', await q('SELECT COUNT(*) c FROM user_apps'));
  console.log('logs       ', await q('SELECT COUNT(*) c FROM auth_logs'));
  console.log('admins     ', await q('SELECT COUNT(*) c FROM users WHERE is_admin=1'));
})();
"

echo
echo "=== seeder is idempotent (second run must not duplicate) ==="
node scripts/seed-demo.js 2>&1 | grep -E "created|logs" | head -5
node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
d.get('SELECT COUNT(*) c FROM users WHERE is_admin=0',(e,r)=>console.log('users after 2nd run:', r?r.c:'ERR'));
"

echo
echo "=== start server and render pages ==="
node src/server.js > /tmp/server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:4040/healthz > /dev/null 2>&1 && break
  sleep 0.5
done

J=/tmp/cj.txt; rm -f $J
curl -s -o /dev/null -c $J -b $J -X POST -d 'username=admin&password=VerifyAdminPass123!' http://127.0.0.1:4040/admin/login

curl -s -b $J -c $J http://127.0.0.1:4040/admin/dashboard > /tmp/dash.html
curl -s -b $J -c $J http://127.0.0.1:4040/admin/users > /tmp/users.html
curl -s -b $J -c $J http://127.0.0.1:4040/admin/apps > /tmp/apps.html
curl -s -b $J -c $J http://127.0.0.1:4040/admin/logs > /tmp/logs.html

PASS=0; FAIL=0
has() {
  local file="$1" needle="$2" label="$3"
  if grep -qF "$needle" "$file"; then
    printf 'PASS  %-46s present\n' "$label"; PASS=$((PASS+1))
  else
    printf 'FAIL  %-46s MISSING\n' "$label"; FAIL=$((FAIL+1))
  fi
}
size() { wc -c < "$1" | tr -d ' '; }

echo
echo "--- dashboard ($(size /tmp/dash.html) bytes) ---"
has /tmp/dash.html "Success Rate" "success rate stat"
has /tmp/dash.html "Failed (24h)" "24h failure stat"
has /tmp/dash.html "Most Used Apps" "top apps panel"
has /tmp/dash.html "confirmPassword" "password confirm field"
has /tmp/dash.html "Recent Attempts" "recent attempts panel"
has /tmp/dash.html "person-circle" "admin badge in navbar"
has /tmp/dash.html ">admin</span>" "admin username rendered"

echo "--- users ($(size /tmp/users.html) bytes) ---"
has /tmp/users.html "alice.reyes" "demo user rendered"
has /tmp/users.html "Driver Ledger PH" "granted app pill"
has /tmp/users.html "assignApp" "assign app control"
has /tmp/users.html "minlength" "password policy hint"

echo "--- apps ($(size /tmp/apps.html) bytes) ---"
has /tmp/apps.html "Nexus Dashboard" "demo app rendered"
has /tmp/apps.html "regenerate-secret" "secret rotation button"
has /tmp/apps.html "copyText" "copy controls"
has /tmp/apps.html "id=\"secret-" "secret element with data value"
SECRET_LEN=$(grep -o 'id="secret-[0-9]*" data-value="[a-f0-9]*"' /tmp/apps.html | head -1 | sed 's/.*data-value="//;s/"//' | tr -d "\n" | wc -c | tr -d " ")
if [ "$SECRET_LEN" -eq 64 ]; then printf 'PASS  %-46s %s chars\n' "client secret is 64 hex chars" "$SECRET_LEN"; PASS=$((PASS+1)); else printf 'FAIL  %-46s got %s\n' "client secret is 64 hex chars" "$SECRET_LEN"; FAIL=$((FAIL+1)); fi

echo "--- logs ($(size /tmp/logs.html) bytes) ---"
has /tmp/logs.html "logSearch" "search box"
has /tmp/logs.html "data-filter=\"success\"" "filter chips"
has /tmp/logs.html "logs.csv" "csv export"
has /tmp/logs.html "data-success=" "log rows with filter data"
has /tmp/logs.html "relative-time" "relative timestamps"

echo
echo "--- end user sign-in page shows app name and destination ---"
CID=$(node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT client_id, redirect_uri FROM apps WHERE name='Driver Ledger PH'\",(e,r)=>console.log(r.client_id+'|'+encodeURIComponent(r.redirect_uri)));")
CID_ONLY="${CID%%|*}"; REDIR="${CID##*|}"
curl -s "http://127.0.0.1:4040/auth/authorize?client_id=$CID_ONLY&redirect_uri=$REDIR" > /tmp/enduser.html
has /tmp/enduser.html "Driver Ledger PH" "app name chip"
has /tmp/enduser.html "You will be returned to" "redirect destination shown"
has /tmp/enduser.html "driverledger.sysitadmin.com" "destination host visible"
if grep -qF 'name="redirect_uri"' /tmp/enduser.html; then
  printf 'FAIL  %-46s still present\n' "redirect_uri NOT in form (should be DB-only)"
  FAIL=$((FAIL+1))
else
  printf 'PASS  %-46s removed\n' "redirect_uri not trusted from form"
  PASS=$((PASS+1))
fi

echo
echo "--- open redirect still closed on the seeded app ---"
EVIL=$(status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:4040/auth/authorize?client_id=$CID_ONLY&redirect_uri=https%3A%2F%2Fevil.example.com"); echo "$status")
if [ "$EVIL" = "400" ]; then printf 'PASS  %-46s 400\n' "evil redirect rejected"; PASS=$((PASS+1));
else printf 'FAIL  %-46s got %s\n' "evil redirect rejected" "$EVIL"; FAIL=$((FAIL+1)); fi

echo
echo "--- demo user can actually sign in and is returned to the app ---"
RETURNED=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST \
  -d "username=alice.reyes&password=demo-access-2024&client_id=$CID_ONLY" \
  http://127.0.0.1:4040/auth/login)
echo "  returned: $RETURNED"
case "$RETURNED" in
  https://driverledger.sysitadmin.com/auth/callback?auth=success*) printf 'PASS  %-46s ok\n' "demo login round trip"; PASS=$((PASS+1));;
  *) printf 'FAIL  %-46s got %s\n' "demo login round trip" "$RETURNED"; FAIL=$((FAIL+1));;
esac

echo
echo "--- CSV export has a header and rows ---"
curl -s -b $J -c $J http://127.0.0.1:4040/admin/logs.csv > /tmp/logs.csv
has /tmp/logs.csv "timestamp,username,app,ip_address" "csv header"
echo "  csv rows: $(( $(wc -l < /tmp/logs.csv) - 1 ))"

echo
echo "=== totals: $PASS passed, $FAIL failed ==="
echo "=== server errors ==="
grep -iE 'error|unhandled' /tmp/server.log | head -10 || true
exit $FAIL
