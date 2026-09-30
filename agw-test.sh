#!/bin/bash
# Smoke test for the auth gateway. Runs inside a throwaway node container.
set -u

cd /app || exit 1

# The node slim images ship without curl, which the assertions below rely on.
if ! command -v curl > /dev/null 2>&1; then
  echo "=== installing curl ==="
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq curl > /dev/null 2>&1
fi

echo "=== npm install ==="
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5

export SESSION_SECRET="test-secret-that-is-definitely-long-enough-1234567890"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="TestAdminPass123!"
export PORT=4040
export DATA_DIR=/app/data
export MIN_PASSWORD_LENGTH=8

echo
echo "=== start server ==="
node src/server.js > /tmp/server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:4040/healthz > /dev/null 2>&1; then break; fi
  sleep 0.5
done

if ! curl -sf http://127.0.0.1:4040/healthz > /dev/null 2>&1; then
  echo "SERVER DID NOT START"
  cat /tmp/server.log
  exit 1
fi

echo "server up"
echo
echo "=== tests ==="

PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'PASS  %-52s %s\n' "$label" "$actual"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %-52s expected=%s actual=%s\n' "$label" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
location() { curl -s -o /dev/null -w '%{redirect_url}' "$@"; }

J=/tmp/cj.txt
rm -f $J

# --- health + public routes ---
check "GET /healthz" 200 "$(status http://127.0.0.1:4040/healthz)"
check "GET / redirects to admin login" "http://127.0.0.1:4040/admin/login" "$(location http://127.0.0.1:4040/)"
check "GET /admin/login" 200 "$(status http://127.0.0.1:4040/admin/login)"
check "GET /nope is 404" 404 "$(status http://127.0.0.1:4040/nope)"

# --- admin auth ---
check "POST /admin/login bad password" 401 "$(status -X POST -d 'username=admin&password=wrong' http://127.0.0.1:4040/admin/login)"
check "GET /admin/dashboard when logged out" "http://127.0.0.1:4040/admin/login" "$(location -c $J http://127.0.0.1:4040/admin/dashboard)"
check "POST /admin/login good" 302 "$(status -c $J -b $J -X POST -d 'username=admin&password=TestAdminPass123!' http://127.0.0.1:4040/admin/login)"
check "GET /admin/dashboard logged in" 200 "$(status -b $J -c $J http://127.0.0.1:4040/admin/dashboard)"

# --- admin pages render ---
for p in dashboard users apps logs; do
  check "GET /admin/$p" 200 "$(status -b $J -c $J http://127.0.0.1:4040/admin/$p)"
done
check "GET /admin/logs.csv" 200 "$(status -b $J -c $J http://127.0.0.1:4040/admin/logs.csv)"

# --- create user ---
check "POST /admin/users create alice" 302 "$(status -b $J -c $J -X POST -d 'username=alice&password=AlicePass123!' http://127.0.0.1:4040/admin/users)"
check "POST /admin/users duplicate alice (was 500)" 302 "$(status -b $J -c $J -X POST -d 'username=alice&password=AlicePass123!' http://127.0.0.1:4040/admin/users)"
check "POST /admin/users weak password rejected" 302 "$(status -b $J -c $J -X POST -d 'username=bob&password=short' http://127.0.0.1:4040/admin/users)"
check "POST /admin/users bad username rejected" 302 "$(status -b $J -c $J -X POST -d 'username=bad user!&password=ValidPass123' http://127.0.0.1:4040/admin/users)"

# --- create app ---
check "POST /admin/apps create" 302 "$(status -b $J -c $J -X POST --data-urlencode 'name=Demo App' --data-urlencode 'redirect_uri=https://app.example.com/callback' http://127.0.0.1:4040/admin/apps)"
check "POST /admin/apps duplicate name (was 500)" 302 "$(status -b $J -c $J -X POST --data-urlencode 'name=Demo App' --data-urlencode 'redirect_uri=https://app.example.com/callback' http://127.0.0.1:4040/admin/apps)"
check "POST /admin/apps bad redirect rejected" 302 "$(status -b $J -c $J -X POST --data-urlencode 'name=Bad App' --data-urlencode 'redirect_uri=notaurl' http://127.0.0.1:4040/admin/apps)"

# --- read the real client_id out of the database ---
CLIENT_ID=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT client_id FROM apps WHERE name='Demo App'\",(e,r)=>{ if(e||!r){console.log('NONE')} else {console.log(r.client_id)} });
" 2>/dev/null)
echo "  (client_id=$CLIENT_ID)"

# --- assign alice to the app ---
ALICE_ID=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT id FROM users WHERE username='alice'\",(e,r)=>{ console.log(r?r.id:'NONE') });
" 2>/dev/null)
APP_ID=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT id FROM apps WHERE name='Demo App'\",(e,r)=>{ console.log(r?r.id:'NONE') });
" 2>/dev/null)

check "POST /admin/assign-app" 302 "$(status -b $J -c $J -X POST -d "user_id=$ALICE_ID&app_id=$APP_ID" http://127.0.0.1:4040/admin/assign-app)"
check "POST /admin/revoke-app" 302 "$(status -b $J -c $J -X POST -d "user_id=$ALICE_ID&app_id=$APP_ID" http://127.0.0.1:4040/admin/revoke-app)"

# revoke must actually remove the grant
GRANTS_AFTER_REVOKE=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get('SELECT COUNT(*) c FROM user_apps WHERE user_id=? AND app_id=?',[$ALICE_ID,$APP_ID],(e,r)=>console.log(r?r.c:'ERR'));
" 2>/dev/null)
check "revoke really removed the grant" "0" "$GRANTS_AFTER_REVOKE"

# re-grant for the authorize tests
curl -s -o /dev/null -b $J -c $J -X POST -d "user_id=$ALICE_ID&app_id=$APP_ID" http://127.0.0.1:4040/admin/assign-app

# --- secret rotation ---
OLD_SECRET=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT client_secret FROM apps WHERE name='Demo App'\",(e,r)=>console.log(r?r.client_secret:'NONE'));
" 2>/dev/null)
curl -s -o /dev/null -b $J -c $J -X POST "http://127.0.0.1:4040/admin/apps/$APP_ID/regenerate-secret"
NEW_SECRET=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT client_secret FROM apps WHERE name='Demo App'\",(e,r)=>console.log(r?r.client_secret:'NONE'));
" 2>/dev/null)
if [ "$OLD_SECRET" != "$NEW_SECRET" ] && [ "$NEW_SECRET" != "NONE" ]; then
  printf 'PASS  %-52s %s\n' "regenerate-secret changed the secret" "yes"
  PASS=$((PASS + 1))
else
  printf 'FAIL  %-52s old=%s new=%s\n' "regenerate-secret changed the secret" "$OLD_SECRET" "$NEW_SECRET"
  FAIL=$((FAIL + 1))
fi

# --- the open redirect tests ---
check "authorize unknown client_id" 403 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=nope")"
check "authorize evil redirect_uri REJECTED" 400 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=$CLIENT_ID&redirect_uri=https://evil.example.com/steal")"
check "authorize protocol-relative redirect REJECTED" 400 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=$CLIENT_ID&redirect_uri=//evil.example.com")"
check "authorize correct redirect_uri shows login" 200 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback")"
check "authorize with wrong client_secret" 403 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&client_secret=deadbeef")"
check "authorize with correct client_secret" 200 "$(status "http://127.0.0.1:4040/auth/authorize?client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&client_secret=$NEW_SECRET")"

# --- end user login flow ---
UJ=/tmp/uj.txt
rm -f $UJ
REDIRECT=$(curl -s -o /dev/null -w '%{redirect_url}' -c $UJ -b $UJ -X POST \
  -d "username=alice&password=AlicePass123!&client_id=$CLIENT_ID" \
  http://127.0.0.1:4040/auth/login)
check "user login redirects to registered host" "https://app.example.com/callback?auth=success&user=alice" "$REDIRECT"

# a registered redirect_uri that already has a query string must survive
curl -s -o /dev/null -b $J -c $J -X POST --data-urlencode 'name=Query App' --data-urlencode 'redirect_uri=https://app.example.com/cb?tenant=acme' http://127.0.0.1:4040/admin/apps
QAPP=$(node -e "
const s=require('sqlite3');
const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT id FROM apps WHERE name='Query App'\",(e,r)=>console.log(r?r.id:'NONE'));
" 2>/dev/null)
curl -s -o /dev/null -b $J -c $J -X POST -d "user_id=$ALICE_ID&app_id=$QAPP" http://127.0.0.1:4040/admin/assign-app
QRED=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST \
  -d "username=alice&password=AlicePass123!&client_id=$(node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT client_id FROM apps WHERE name='Query App'\",(e,r)=>console.log(r.client_id));")" \
  http://127.0.0.1:4040/auth/login)
check "existing query string preserved on redirect" "https://app.example.com/cb?tenant=acme&auth=success&user=alice" "$QRED"

# no-access user must be bounced back with auth=failed
curl -s -o /dev/null -b $J -c $J -X POST -d 'username=nobody&password=NoAccess123!' http://127.0.0.1:4040/admin/users
NOBODY=$(node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
d.get(\"SELECT id FROM users WHERE username='nobody'\",(e,r)=>console.log(r?r.id:'NONE'));")
NORED=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST \
  -d "username=nobody&password=NoAccess123!&client_id=$CLIENT_ID" \
  http://127.0.0.1:4040/auth/login)
check "user without access is refused" "https://app.example.com/callback?auth=failed&reason=no_access" "$NORED"

# --- rate limiting ---
RL=0
for i in $(seq 1 14); do
  S=$(status -X POST -d "username=alice&password=wrongpass$i" -d "client_id=$CLIENT_ID" http://127.0.0.1:4040/auth/login)
  if [ "$S" = "429" ]; then RL=1; fi
done
check "brute force gets rate limited" "1" "$RL"

# --- trust proxy: a string "1" is read by Express as an address, not a hop count ---
TP=/tmp/tp.txt
rm -f $TP
curl -s -o /dev/null -c $TP -X POST -d 'username=admin&password=TestAdminPass123!' \
  -H 'X-Forwarded-Proto: https' http://127.0.0.1:4040/admin/login
if [ -f $TP ] && grep -q 'agw.sid' $TP; then
  SECURE=$(grep 'agw.sid' $TP | awk -F'\t' '{print $4}')
  if [ "$SECURE" = "TRUE" ]; then
    printf 'PASS  %-52s %s\n' "session cookie Secure over TLS" "TRUE"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %-52s got "%s" (trust proxy not honoured?)\n' "session cookie Secure over TLS" "$SECURE"
    FAIL=$((FAIL + 1))
  fi
else
  printf 'FAIL  %-52s no cookie issued\n' "session cookie Secure over TLS"
  FAIL=$((FAIL + 1))
fi

# --- headers ---
HDR=$(curl -sI http://127.0.0.1:4040/admin/login)
echo "$HDR" | grep -qi 'x-frame-options: DENY' && R1=1 || R1=0
echo "$HDR" | grep -qi 'content-security-policy' && R2=1 || R2=0
check "X-Frame-Options present" "1" "$R1"
check "CSP present" "1" "$R2"

# --- cascade delete ---
curl -s -o /dev/null -b $J -c $J -X POST "http://127.0.0.1:4040/admin/users/$ALICE_ID/delete"
ORPHANS=$(node -e "
const s=require('sqlite3');const d=new s.Database('/app/data/auth-gateway.db');
d.get('SELECT COUNT(*) c FROM user_apps WHERE user_id=?',[$ALICE_ID],(e,r)=>console.log(r?r.c:'ERR'));
" 2>/dev/null)
check "deleting user cascades to user_apps" "0" "$ORPHANS"

echo
echo "=== totals: $PASS passed, $FAIL failed ==="

echo
echo "=== server log (errors only) ==="
grep -iE 'error|unhandled|throw' /tmp/server.log | head -20 || echo "no errors logged"

exit $FAIL
