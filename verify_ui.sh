#!/bin/sh
echo "== health =="
echo -n "app.sct.chat/health -> "; curl -s https://app.sct.chat/health; echo
echo -n "sct.chat/health     -> "; curl -s https://sct.chat/health; echo

echo
echo "== new bundle deployed? =="
echo -n "gradient 63b3ff in bundle: "; docker exec support-chat-app sh -c "grep -l '63b3ff' /app/frontend-react/dist/assets/*.js 2>/dev/null | wc -l"
echo -n "'Ср. ответ' label:        "; docker exec support-chat-app sh -c "grep -l 'Ср. ответ' /app/frontend-react/dist/assets/*.js 2>/dev/null | wc -l"
echo -n "old 'Ср. время ответа':    "; docker exec support-chat-app sh -c "grep -l 'Ср. время ответа' /app/frontend-react/dist/assets/*.js 2>/dev/null | wc -l"
echo -n "reset button height 40:   "; docker exec support-chat-app sh -c "grep -c 'alignSelf' /app/frontend-react/dist/assets/*.js 2>/dev/null | head -1"

echo
echo "== stats data for tenant 3 (so the chart has something to draw) =="
cat > /tmp/stats_probe.js << 'JS'
const https = require('https');
const jwt = require('jsonwebtoken');
const t = jwt.sign({ id: 2, name: 'Олег', role: 'admin', tid: 3, tv: 3 }, process.env.JWT_SECRET, { expiresIn: '10m' });
function get(path) {
  return new Promise((res, rej) => {
    const r = https.request({ host: 'app.sct.chat', port: 443, path, method: 'GET', headers: { Cookie: 'sc_token=' + t } }, (x) => {
      let b = ''; x.setEncoding('utf8'); x.on('data', c => b += c); x.on('end', () => res({ status: x.statusCode, body: b }));
    });
    r.on('error', rej); r.end();
  });
}
(async () => {
  const s = await get('/stats');
  console.log('/stats       ->', s.status, s.body);
  const d = await get('/stats/daily');
  console.log('/stats/daily ->', d.status, d.body);
  try {
    const arr = JSON.parse(d.body);
    console.log('  days:', arr.length, '| values:', arr.map(x => x.day + '=' + x.count).join(' '));
  } catch {}
})();
JS
docker cp /tmp/stats_probe.js support-chat-app:/app/backend/stats_probe.js >/dev/null
docker exec support-chat-app node /app/backend/stats_probe.js
docker exec support-chat-app rm -f /app/backend/stats_probe.js
rm -f /tmp/stats_probe.js
