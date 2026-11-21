// Minimal client for the two Supervisor endpoints this App reads. Both are
// available to every App without extra API permissions:
//   GET /services/mqtt     broker offered by the MQTT service (needs services: mqtt:want)
//   GET /addons/self/info  this App's own description, including the port mapping
// Failures never abort startup: the caller gets null and decides.

export async function supervisorGet(baseUrl, token, endpoint, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, reason: 'no Supervisor token' };
  try {
    const r = await fetchImpl(`${baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || body.result !== 'ok') return { ok: false, reason: `HTTP ${r.status}` };
    return { ok: true, data: body.data ?? null };
  } catch (e) {
    return { ok: false, reason: e && e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

// Container ports (numbers) that the user mapped to a host port, from the
// "network" field of /addons/self/info, e.g. { "8095/tcp": 8095, "4404/tcp": null }.
export function publishedPorts(info) {
  const out = [];
  const network = info && typeof info === 'object' ? info.network : null;
  if (!network || typeof network !== 'object') return out;
  for (const [key, host] of Object.entries(network)) {
    const m = /^(\d+)\/tcp$/i.exec(key);
    if (m && host !== null && host !== undefined && host !== '') out.push(Number(m[1]));
  }
  return out;
}

// LMM_PUBLISHED_PORTS override: "8095,4404", or "none"/"" for no port.
export function parsePortList(value) {
  return String(value || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
}
