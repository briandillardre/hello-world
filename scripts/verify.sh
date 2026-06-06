#!/usr/bin/env bash
# Pre-publish verification: build, route smoke test, and feature-logic checks.
# Run before every push to live. (No headless browser available in this env,
# so this is build + server-render + logic — not pixel rendering.)
set -e
cd "$(dirname "$0")/.."

echo "▸ 1/3  Production build (type-check + compile)"
npm run build >/tmp/verify-build.log 2>&1 && echo "  ✓ build passed" || { echo "  ✗ build FAILED"; tail -20 /tmp/verify-build.log; exit 1; }

echo "▸ 2/3  Route smoke test"
(npm run start >/tmp/verify-srv.log 2>&1 &) ; sleep 6
fail=0
check () { c=$(curl -s -o /tmp/vbody -w "%{http_code}" "http://localhost:3000$1"); m=$(grep -c -- "$2" /tmp/vbody || true); [ "$c" = "200" ] && [ "$m" -ge 1 ] && echo "  ✓ $1 ($c)" || { echo "  ✗ $1 ($c, marker=$m)"; fail=1; }; }
check "/" "You already got the text"; check "/pricing" "pays for itself"; check "/demo" "Would you know"
check "/map" "Loading map"; check "/command" "Equip running"; check "/assets" "Asset"; check "/alerts" "Alert"
check "/reports" "Utilization"; check "/maintenance" "Maintenance"; check "/accounting" "QuickBooks"; check "/settings" "Settings"
lsof -ti tcp:3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true

echo "▸ 3/3  Feature-logic checks"
npx tsc scripts/verify-logic.ts lib/trails.ts lib/projects.ts lib/weather.ts lib/site-devices.ts lib/mock-data.ts lib/types.ts \
  --outDir /tmp/vout --module nodenext --moduleResolution nodenext --target es2020 --skipLibCheck >/dev/null 2>&1
node /tmp/vout/scripts/verify-logic.js || fail=1

[ "$fail" = "0" ] && echo "✅ VERIFY PASSED" || { echo "❌ VERIFY FAILED"; exit 1; }
