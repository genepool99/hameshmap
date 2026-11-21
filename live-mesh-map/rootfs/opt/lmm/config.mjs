// Translation of Home Assistant App options into the environment expected by
// Live Mesh Map World. Pure functions only: no file, network or process access.
//
// Upstream facts this module relies on :
//   * carte-live/src/config.js accepts yes/no/true/false through an alias
//     table, but carte-live/src/domotique.js compares DOMOTIQUE_DECOUVERTE and
//     DOMOTIQUE_ENVOI_LORA with the literal string "oui". Booleans are
//     therefore always written as "oui" / "non".
//   * An empty DOMOTIQUE_MQTT_URL disables the home-automation output.
//   * mqtts:// and wss:// are verified against the system CA store unless
//     MQTT_TLS_NON_VERIFIE=oui, which this App never sets.
//   * Settings saved from the map's own Settings screens are stored in
//     /data/reglages.json and take precedence over the environment.

const BROKER_SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:'];
const TLS_SCHEMES = ['mqtts:', 'wss:'];
const SECRET_KEY = /(MOT_DE_PASSE|PASSWORD|UTILISATEUR|USERNAME|JETON|TOKEN|SECRET|CLE_)/i;

export const DEFAULT_HA_ROOT_TOPIC = 'live-mesh-map';
export const WEB_PORT = 8095;
export const AGENTS_PORT = 4404;
export const INGRESS_PORT = 8099;
// Address of the Home Assistant ingress gateway, and of the host as seen from
// the App network. Both are fixed by the Supervisor's internal network.
export const SUPERVISOR_INGRESS_ADDRESS = '172.30.32.2';
export const TRUSTED_PROXIES = `loopback, 172.30.32.1, ${SUPERVISOR_INGRESS_ADDRESS}`;

const ouiNon = (b) => (b ? 'oui' : 'non');
const isSet = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const text = (v) => String(v).trim();
const oneLine = (v) => !/[\r\n\0]/.test(String(v));

function readBool(options, name, fallback, errors) {
  const v = options[name];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  errors.push(`Option "${name}" must be true or false.`);
  return fallback;
}

function readText(options, name, errors, { max = 500 } = {}) {
  const v = options[name];
  if (!isSet(v)) return '';
  if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`Option "${name}" must be text.`); return ''; }
  if (!oneLine(v)) { errors.push(`Option "${name}" must be a single line.`); return ''; }
  const s = text(v);
  if (s.length > max) { errors.push(`Option "${name}" is too long (${max} characters at most).`); return ''; }
  return s;
}

// Secrets keep their exact value (no trimming).
function readSecret(options, name, errors) {
  const v = options[name];
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !oneLine(v) || v.length > 500) { errors.push(`Option "${name}" must be a single line of text.`); return ''; }
  return v;
}

// Validates a broker URL without ever echoing it (it may contain a secret).
function readBrokerUrl(options, name, errors) {
  const s = readText(options, name, errors);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { errors.push(`Option "${name}" is not a valid URL (expected for example mqtt://host:1883).`); return ''; }
  if (!BROKER_SCHEMES.includes(u.protocol)) { errors.push(`Option "${name}" must start with mqtt://, mqtts://, ws:// or wss://.`); return ''; }
  if (!u.hostname) { errors.push(`Option "${name}" has no host name.`); return ''; }
  if (u.username || u.password) { errors.push(`Option "${name}" must not contain a user name or password; use the separate user name and password options.`); return ''; }
  return s;
}

function readTopic(options, name, errors) {
  const s = readText(options, name, errors, { max: 200 });
  if (!s) return '';
  // A trailing "/#" is a common way to write a prefix; upstream adds it itself.
  const t = s.replace(/\/+#?$/, '').replace(/^\/+/, '');
  if (!t || /[#+]/.test(t) || /\s/.test(t)) { errors.push(`Option "${name}" must be a plain MQTT topic prefix without wildcards or spaces.`); return ''; }
  return t;
}

// Supervisor "mqtt" service payload: { host, port, ssl, username, password, protocol }.
function serviceBroker(mqttService, warnings) {
  if (!mqttService || typeof mqttService !== 'object') return null;
  const host = isSet(mqttService.host) ? text(mqttService.host) : '';
  const port = Number(mqttService.port);
  if (!host || !/^[A-Za-z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    warnings.push('The MQTT service offered by Home Assistant is incomplete (host or port missing); it is ignored.');
    return null;
  }
  const tls = mqttService.ssl === true;
  const bracket = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  if (tls) warnings.push('The Home Assistant MQTT service uses TLS: its certificate must be valid for the broker host name, certificate checks are never disabled. If the connection fails, set a manual broker.');
  return {
    url: `${tls ? 'mqtts' : 'mqtt'}://${bracket}:${port}`,
    username: isSet(mqttService.username) ? String(mqttService.username) : '',
    password: mqttService.password === undefined || mqttService.password === null ? '' : String(mqttService.password),
  };
}

export function buildEnvironment({ options, mqttService = null } = {}) {
  const env = {};
  const warnings = [];
  const errors = [];
  const info = [];

  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return { env, warnings, info, errors: ['The options must be a JSON object.'] };
  }
  const o = options;

  // ---- Fixed settings: where upstream listens and stores its state --------
  env.PORT = String(WEB_PORT);
  env.AGENTS_PORT = String(AGENTS_PORT);
  env.FICHIER_BASE = '/data/carte-live.db';
  env.NODE_ENV = 'production';
  // X-Forwarded-* is only believed from the ingress hop inside this container
  // and from the Home Assistant gateway addresses.
  env.PROXY_CONFIANCE = TRUSTED_PROXIES;
  // Home Assistant owns updates: no query to GitHub, no "update" prompt.
  env.VERIFIER_MAJ = 'non';
  // Multicast discovery needs the host network, which this App does not use.
  env.MDNS_MESHTASTIC = 'non';
  env.UDP_MESHTASTIC = 'non';
  // TLS certificates of MQTT brokers are always verified.
  env.MQTT_TLS_NON_VERIFIE = 'non';
  // French-only alert features are hidden at first start (changeable in the map settings).
  env.FONCTIONS_MASQUEES = 'vigipirate,fr-alert,bipper';

  // ---- Map ----------------------------------------------------------------
  const area = readText(o, 'map_area', errors).toUpperCase();
  if (area) {
    if (/^M[NS]\d{2}[EW]\d{3}$/.test(area) || /^(\d{2,3}|2[AB])$/.test(area)) env.DEPARTEMENT = area;
    else errors.push('Option "map_area" must be a 1-degree square such as MN40W075 (south-west corner 40°N 75°W) or a French department number.');
  }
  const areaName = readText(o, 'map_area_name', errors, { max: 80 });
  if (areaName) env.ZONE_NOM = areaName;

  if (isSet(o.radio_frequency_mhz)) {
    const f = Number(o.radio_frequency_mhz);
    if (Number.isFinite(f) && f >= 100 && f <= 3000) env.RADIO_FREQ_MHZ = String(f);
    else errors.push('Option "radio_frequency_mhz" must be a frequency in MHz between 100 and 3000 (for example 869.525 or 906.875).');
  }

  const lang = readText(o, 'log_language', errors) || 'en';
  if (lang === 'en' || lang === 'fr') env.LANGUE = lang;
  else errors.push('Option "log_language" must be "en" or "fr".');

  // ---- Mesh input broker (Meshtastic / MeshCore traffic) --------------------
  const meshUrl = readBrokerUrl(o, 'mesh_mqtt_url', errors);
  const meshUser = readText(o, 'mesh_mqtt_username', errors);
  const meshPass = readSecret(o, 'mesh_mqtt_password', errors);
  const meshRoot = readTopic(o, 'mesh_mqtt_root_topic', errors);
  if (meshUrl) {
    env.MQTT_URL = meshUrl;
    env.MQTT_UTILISATEUR = meshUser;
    env.MQTT_MOT_DE_PASSE = meshPass;
  } else {
    if (meshUser || meshPass) warnings.push('"mesh_mqtt_username"/"mesh_mqtt_password" are ignored because "mesh_mqtt_url" is empty.');
    info.push('Mesh MQTT broker: not set in the App options; configure it here or in the map setup wizard.');
  }
  if (meshRoot) env.MQTT_RACINE = meshRoot;

  // ---- MeshCore -----------------------------------------------------------
  env.MESHCORE = ouiNon(readBool(o, 'meshcore_enabled', true, errors));
  const iata = readText(o, 'meshcore_iata', errors).toUpperCase();
  if (iata) {
    if (/^[A-Z0-9]{2,8}$/.test(iata)) env.MESHCORE_IATA = iata;
    else errors.push('Option "meshcore_iata" must be an area code of 2 to 8 letters or digits (nearest airport, for example PHL).');
  }

  // ---- Home Assistant output (upstream "domotique") -------------------------
  const haEnabled = readBool(o, 'ha_mqtt_enabled', true, errors);
  const haUrl = readBrokerUrl(o, 'ha_mqtt_url', errors);
  const haUser = readText(o, 'ha_mqtt_username', errors);
  const haPass = readSecret(o, 'ha_mqtt_password', errors);
  const haRoot = readTopic(o, 'ha_mqtt_root_topic', errors) || DEFAULT_HA_ROOT_TOPIC;
  const discovery = readBool(o, 'ha_mqtt_discovery', true, errors);
  const loraSend = readBool(o, 'ha_mqtt_lora_send', false, errors);

  let haSource = 'disabled';
  env.DOMOTIQUE_MQTT_URL = '';
  env.DOMOTIQUE_MQTT_UTILISATEUR = '';
  env.DOMOTIQUE_MQTT_MOT_DE_PASSE = '';
  if (!haEnabled) {
    info.push('Home Assistant MQTT output: disabled by option "ha_mqtt_enabled".');
  } else if (haUrl) {
    // A manual broker is used exactly as given; the Supervisor service never overrides it.
    haSource = 'manual';
    env.DOMOTIQUE_MQTT_URL = haUrl;
    env.DOMOTIQUE_MQTT_UTILISATEUR = haUser;
    env.DOMOTIQUE_MQTT_MOT_DE_PASSE = haPass;
    info.push('Home Assistant MQTT output: manual broker from the App options.');
  } else {
    if (haUser || haPass) warnings.push('"ha_mqtt_username"/"ha_mqtt_password" are ignored because "ha_mqtt_url" is empty.');
    const svc = serviceBroker(mqttService, warnings);
    if (svc) {
      haSource = 'supervisor';
      env.DOMOTIQUE_MQTT_URL = svc.url;
      env.DOMOTIQUE_MQTT_UTILISATEUR = svc.username;
      env.DOMOTIQUE_MQTT_MOT_DE_PASSE = svc.password;
      info.push('Home Assistant MQTT output: broker provided by the Home Assistant MQTT service.');
    } else {
      info.push('Home Assistant MQTT output: disabled (no manual broker and no MQTT service offered by Home Assistant).');
    }
  }
  env.DOMOTIQUE_RACINE = haRoot;
  env.DOMOTIQUE_DECOUVERTE = ouiNon(discovery);
  env.DOMOTIQUE_ENVOI_LORA = ouiNon(loraSend);
  if (loraSend && haSource !== 'disabled') warnings.push(`LoRa transmission from MQTT is ENABLED: messages published to ${haRoot}/envoyer are sent over the radio.`);

  for (const [name, url] of [['mesh_mqtt_url', meshUrl], ['ha_mqtt_url', haUrl]]) {
    if (url && !TLS_SCHEMES.includes(new URL(url).protocol) && (name === 'mesh_mqtt_url' ? meshPass : haPass)) {
      warnings.push(`"${name}" is not encrypted (mqtt:// or ws://): the password travels in clear text on the network.`);
    }
  }

  // ---- Access ---------------------------------------------------------------
  const exportToken = readSecret(o, 'export_token', errors);
  if (exportToken) env.EXPORT_JETON = exportToken;
  const setupCode = readSecret(o, 'setup_code', errors);
  if (setupCode) env.ADMIN_MOT_DE_PASSE = setupCode;

  if (errors.length) return { env: {}, warnings, info, errors };
  return { env, warnings, info, errors, haSource };
}

// Copy of an environment that is safe to print: secrets are masked and
// credentials embedded in URLs are removed.
export function redact(env) {
  const out = {};
  for (const [k, raw] of Object.entries(env || {})) {
    const v = String(raw ?? '');
    if (SECRET_KEY.test(k)) { out[k] = v === '' ? '' : '***'; continue; }
    out[k] = redactText(v);
  }
  return out;
}

// Removes user:password@ from anything that looks like a URL inside a text.
export function redactText(s) {
  return String(s).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@');
}

// Upstream applies the settings saved from the map (reglages.json, field
// "variables") over its environment at every start, so an administrator of
// the map can replace values set by this App. Returns the names (never the
// values) of the variables of env that such saved settings replace with a
// different value. settings is the parsed reglages.json, or null.
export function overriddenByMapSettings(env, settings) {
  const saved = settings && typeof settings === 'object' && settings.variables && typeof settings.variables === 'object' && !Array.isArray(settings.variables) ? settings.variables : {};
  const names = [];
  for (const [name, value] of Object.entries(saved)) {
    if (value === null || value === undefined) continue;
    if (Object.hasOwn(env || {}, name) && String(value) !== String(env[name])) names.push(name);
  }
  return names.sort();
}
