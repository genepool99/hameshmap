// Fake Home Assistant Supervisor API for local container tests.
//
// NOT the real Supervisor. It implements only what the App's startup code
// uses: GET /services/mqtt and GET /addons/self/info (only its "network"
// field) with "Authorization: Bearer <token>", answering in the Supervisor
// envelope {"result":"ok","data":{...}}.
// Response shape taken from the Supervisor API documentation
// (developers.home-assistant.io/docs/api/supervisor/endpoints, "Service").
//
// Environment:
//   FAKE_MODE   mqtt  -> service data from FAKE_MQTT_HOST/USER/PASS
//               none  -> 400 {"result":"error","message":"Service not enabled"}
//               error -> 500 with a non-JSON body
//   FAKE_TOKEN  expected bearer token (requests without it get 401)
//   FAKE_NETWORK  JSON for the "network" field of GET /addons/self/info
//               (default: both optional ports unmapped, as on a fresh install)
// Harness endpoints (never present on a real Supervisor):
//   GET /__harness/ready     200
//   GET /__harness/requests  JSON list of {method, url, authorized}
import http from 'node:http';

const mode = process.env.FAKE_MODE || 'mqtt';
const token = process.env.FAKE_TOKEN || '';
const requests = [];

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/__harness/ready') return send(res, 200, { ok: true });
  if (url === '/__harness/requests') return send(res, 200, requests);

  const auth = req.headers.authorization || '';
  const legacy = req.headers['x-supervisor-token'] || '';
  const authorized = token !== '' && (auth === `Bearer ${token}` || legacy === token);
  // The token itself is never stored or printed.
  requests.push({ method: req.method, url: req.url, authorized });
  console.log(`${req.method} ${req.url} authorized=${authorized}`);

  if (!authorized) return send(res, 401, { result: 'error', message: 'Unauthorized' });
  if (req.method === 'GET' && url === '/services/mqtt') {
    if (mode === 'none') return send(res, 400, { result: 'error', message: 'Service not enabled' });
    if (mode === 'error') return send(res, 500, 'Internal Server Error', 'text/plain');
    return send(res, 200, {
      result: 'ok',
      data: {
        addon: 'core_mosquitto',
        host: process.env.FAKE_MQTT_HOST || '',
        port: 1883,
        ssl: false,
        protocol: '3.1.1',
        username: process.env.FAKE_MQTT_USER || '',
        password: process.env.FAKE_MQTT_PASS || '',
      },
    });
  }
  if (req.method === 'GET' && url === '/addons/self/info') {
    if (mode === 'error') return send(res, 500, 'Internal Server Error', 'text/plain');
    let network = { '8095/tcp': null, '4404/tcp': null };
    try { if (process.env.FAKE_NETWORK) network = JSON.parse(process.env.FAKE_NETWORK); } catch { /* keep default */ }
    return send(res, 200, { result: 'ok', data: { slug: 'local_live_mesh_map', state: 'started', ingress: true, ingress_port: 8099, network } });
  }
  return send(res, 404, { result: 'error', message: 'Not found in the fake Supervisor' });
}).listen(80, '0.0.0.0', () => console.log(`fake supervisor listening, mode=${mode}`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
