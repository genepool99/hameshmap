import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvironment, redact, redactText, DEFAULT_HA_ROOT_TOPIC } from '../../live-mesh-map/rootfs/opt/lmm/config.mjs';

const service = { addon: 'core_mosquitto', host: 'core-mosquitto', port: '1883', ssl: false, username: 'addons', password: 'service-pass', protocol: '3.1.1' };

test('defaults: fixed settings, no broker, LoRa send off', () => {
  const r = buildEnvironment({ options: {}, mqttService: null });
  assert.deepEqual(r.errors, []);
  assert.equal(r.env.PORT, '8095');
  assert.equal(r.env.AGENTS_PORT, '4404');
  assert.equal(r.env.FICHIER_BASE, '/data/carte-live.db');
  assert.equal(r.env.VERIFIER_MAJ, 'non');
  assert.equal(r.env.MDNS_MESHTASTIC, 'non');
  assert.equal(r.env.UDP_MESHTASTIC, 'non');
  assert.equal(r.env.MQTT_TLS_NON_VERIFIE, 'non');
  assert.equal(r.env.LANGUE, 'en');
  assert.equal(r.env.MESHCORE, 'oui');
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, '');
  assert.equal(r.env.DOMOTIQUE_ENVOI_LORA, 'non');
  assert.equal(r.env.DOMOTIQUE_DECOUVERTE, 'oui');
  assert.equal(r.env.DOMOTIQUE_RACINE, DEFAULT_HA_ROOT_TOPIC);
  assert.equal(r.haSource, 'disabled');
  assert.ok(!('MQTT_URL' in r.env), 'mesh broker is left to the setup wizard');
  assert.ok(!('DEPARTEMENT' in r.env));
  assert.ok(!('ADMIN_MOT_DE_PASSE' in r.env));
  assert.ok(r.info.some((l) => /output: disabled/.test(l)));
});

test('every value is a string', () => {
  const r = buildEnvironment({ options: { radio_frequency_mhz: 906.875, map_area: 'mn40w075' }, mqttService: service });
  for (const [k, v] of Object.entries(r.env)) assert.equal(typeof v, 'string', k);
});

test('booleans are translated to the French words upstream compares with', () => {
  const on = buildEnvironment({ options: { meshcore_enabled: true, ha_mqtt_discovery: true, ha_mqtt_lora_send: true }, mqttService: service });
  assert.equal(on.env.MESHCORE, 'oui');
  assert.equal(on.env.DOMOTIQUE_DECOUVERTE, 'oui');
  assert.equal(on.env.DOMOTIQUE_ENVOI_LORA, 'oui');
  assert.ok(on.warnings.some((w) => /LoRa transmission from MQTT is ENABLED/.test(w)));
  const off = buildEnvironment({ options: { meshcore_enabled: false, ha_mqtt_discovery: false, ha_mqtt_lora_send: false }, mqttService: service });
  assert.equal(off.env.MESHCORE, 'non');
  assert.equal(off.env.DOMOTIQUE_DECOUVERTE, 'non');
  assert.equal(off.env.DOMOTIQUE_ENVOI_LORA, 'non');
});

test('non-boolean values for boolean options are rejected, not guessed', () => {
  for (const v of ['yes', 'oui', 1, 'true']) {
    const r = buildEnvironment({ options: { ha_mqtt_lora_send: v } });
    assert.equal(r.errors.length, 1, String(v));
    assert.deepEqual(r.env, {});
  }
});

test('Supervisor MQTT service is used when no manual broker is set', () => {
  const r = buildEnvironment({ options: {}, mqttService: service });
  assert.equal(r.haSource, 'supervisor');
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, 'mqtt://core-mosquitto:1883');
  assert.equal(r.env.DOMOTIQUE_MQTT_UTILISATEUR, 'addons');
  assert.equal(r.env.DOMOTIQUE_MQTT_MOT_DE_PASSE, 'service-pass');
  assert.ok(!r.env.DOMOTIQUE_MQTT_URL.includes('service-pass'), 'credentials never embedded in the URL');
});

test('Supervisor service with TLS gives mqtts and a warning, verification stays on', () => {
  const r = buildEnvironment({ options: {}, mqttService: { ...service, ssl: true, port: 8883 } });
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, 'mqtts://core-mosquitto:8883');
  assert.equal(r.env.MQTT_TLS_NON_VERIFIE, 'non');
  assert.ok(r.warnings.some((w) => /TLS/.test(w)));
});

test('manual broker is used exactly and never overridden by the service', () => {
  const r = buildEnvironment({
    options: { ha_mqtt_url: 'mqtts://broker.example.org:8883', ha_mqtt_username: 'me', ha_mqtt_password: ' p w ' },
    mqttService: service,
  });
  assert.equal(r.haSource, 'manual');
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, 'mqtts://broker.example.org:8883');
  assert.equal(r.env.DOMOTIQUE_MQTT_UTILISATEUR, 'me');
  assert.equal(r.env.DOMOTIQUE_MQTT_MOT_DE_PASSE, ' p w ', 'password kept verbatim');
});

test('manual broker without credentials does not borrow the service credentials', () => {
  const r = buildEnvironment({ options: { ha_mqtt_url: 'mqtt://10.0.0.5:1883' }, mqttService: service });
  assert.equal(r.env.DOMOTIQUE_MQTT_UTILISATEUR, '');
  assert.equal(r.env.DOMOTIQUE_MQTT_MOT_DE_PASSE, '');
});

test('output disabled by option ignores both manual broker and service', () => {
  const r = buildEnvironment({ options: { ha_mqtt_enabled: false, ha_mqtt_url: 'mqtt://10.0.0.5:1883' }, mqttService: service });
  assert.equal(r.haSource, 'disabled');
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, '');
  assert.equal(r.env.DOMOTIQUE_MQTT_MOT_DE_PASSE, '');
});

test('incomplete service payload is ignored with a warning', () => {
  for (const bad of [{ host: '', port: 1883 }, { host: 'h', port: 'abc' }, { host: 'h h', port: 1883 }, 'nonsense']) {
    const r = buildEnvironment({ options: {}, mqttService: bad });
    assert.equal(r.env.DOMOTIQUE_MQTT_URL, '');
    assert.equal(r.haSource, 'disabled');
  }
});

test('mesh broker settings are independent of the Home Assistant output', () => {
  const r = buildEnvironment({
    options: { mesh_mqtt_url: 'mqtts://mqtt.example.org:8883', mesh_mqtt_username: 'meshdev', mesh_mqtt_password: 'large4cats', mesh_mqtt_root_topic: 'msh/US/#' },
    mqttService: service,
  });
  assert.equal(r.env.MQTT_URL, 'mqtts://mqtt.example.org:8883');
  assert.equal(r.env.MQTT_UTILISATEUR, 'meshdev');
  assert.equal(r.env.MQTT_MOT_DE_PASSE, 'large4cats');
  assert.equal(r.env.MQTT_RACINE, 'msh/US');
  assert.equal(r.env.DOMOTIQUE_MQTT_URL, 'mqtt://core-mosquitto:1883');
});

test('root topics: wildcards rejected, slashes trimmed', () => {
  assert.equal(buildEnvironment({ options: { mesh_mqtt_root_topic: '/msh/EU_868/' } }).env.MQTT_RACINE, 'msh/EU_868');
  assert.equal(buildEnvironment({ options: { mesh_mqtt_root_topic: 'msh/US/#' } }).env.MQTT_RACINE, 'msh/US');
  assert.equal(buildEnvironment({ options: { mesh_mqtt_root_topic: 'msh/+/2' } }).errors.length, 1);
  assert.equal(buildEnvironment({ options: { mesh_mqtt_root_topic: '#' } }).errors.length, 1);
  assert.equal(buildEnvironment({ options: { ha_mqtt_root_topic: 'a b' } }).errors.length, 1);
  assert.equal(buildEnvironment({ options: { ha_mqtt_root_topic: 'home/mesh' } }).env.DOMOTIQUE_RACINE, 'home/mesh');
});

test('broker URLs: scheme, host and embedded credentials are checked without echoing the value', () => {
  const cases = ['http://broker:1883', 'broker:1883', 'mqtt://', 'mqtt://user:hunter2@broker:1883', 'mqtt://user@broker'];
  for (const url of cases) {
    for (const name of ['mesh_mqtt_url', 'ha_mqtt_url']) {
      const r = buildEnvironment({ options: { [name]: url } });
      assert.equal(r.errors.length, 1, `${name}=${url}`);
      assert.ok(r.errors[0].includes(name));
      assert.ok(!r.errors[0].includes('hunter2'), 'secret not repeated in the message');
      assert.deepEqual(r.env, {}, 'no environment when there are errors');
    }
  }
});

test('map area, frequency, IATA and language validation', () => {
  const ok = buildEnvironment({ options: { map_area: 'ms33e151', map_area_name: 'Sydney', radio_frequency_mhz: 919.875, meshcore_iata: 'syd', log_language: 'fr' } });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.env.DEPARTEMENT, 'MS33E151');
  assert.equal(ok.env.ZONE_NOM, 'Sydney');
  assert.equal(ok.env.RADIO_FREQ_MHZ, '919.875');
  assert.equal(ok.env.MESHCORE_IATA, 'SYD');
  assert.equal(ok.env.LANGUE, 'fr');
  assert.equal(buildEnvironment({ options: { map_area: '2a' } }).env.DEPARTEMENT, '2A');
  for (const bad of [{ map_area: 'Paris' }, { map_area: 'MN4W075' }, { radio_frequency_mhz: 'fast' }, { radio_frequency_mhz: 5 }, { meshcore_iata: 'P' }, { meshcore_iata: 'PH L' }, { log_language: 'de' }]) {
    assert.equal(buildEnvironment({ options: bad }).errors.length, 1, JSON.stringify(bad));
  }
});

test('multi-line and oversized values are rejected (no environment injection)', () => {
  assert.equal(buildEnvironment({ options: { map_area_name: 'a\nEVIL=1' } }).errors.length, 1);
  assert.equal(buildEnvironment({ options: { export_token: 'a\r\nb' } }).errors.length, 1);
  assert.equal(buildEnvironment({ options: { setup_code: 'x'.repeat(501) } }).errors.length, 1);
});

test('tokens are passed through', () => {
  const r = buildEnvironment({ options: { export_token: 'tok', setup_code: 'code' } });
  assert.equal(r.env.EXPORT_JETON, 'tok');
  assert.equal(r.env.ADMIN_MOT_DE_PASSE, 'code');
});

test('options must be an object', () => {
  for (const bad of [null, [], 'x', 3]) assert.equal(buildEnvironment({ options: bad }).errors.length, 1);
  assert.equal(buildEnvironment().errors.length, 1);
});

test('warnings: unused credentials and clear-text passwords', () => {
  const a = buildEnvironment({ options: { ha_mqtt_username: 'u', mesh_mqtt_password: 'p' } });
  assert.equal(a.warnings.filter((w) => /ignored/.test(w)).length, 2);
  const b = buildEnvironment({ options: { mesh_mqtt_url: 'mqtt://h:1883', mesh_mqtt_password: 'p' } });
  assert.ok(b.warnings.some((w) => /not encrypted/.test(w)));
  const c = buildEnvironment({ options: { mesh_mqtt_url: 'mqtts://h:8883', mesh_mqtt_password: 'p' } });
  assert.ok(!c.warnings.some((w) => /not encrypted/.test(w)));
});

test('no message ever contains a secret value', () => {
  const secrets = ['mesh-pass-1', 'ha-pass-2', 'export-3', 'setup-4', 'service-pass'];
  const r = buildEnvironment({
    options: { mesh_mqtt_url: 'mqtt://h:1883', mesh_mqtt_password: secrets[0], ha_mqtt_password: secrets[1], export_token: secrets[2], setup_code: secrets[3], ha_mqtt_lora_send: true },
    mqttService: service,
  });
  const text = JSON.stringify([r.warnings, r.info, r.errors]);
  for (const s of secrets) assert.ok(!text.includes(s), s);
});

test('redact masks secrets and user names, keeps the rest, does not mutate', () => {
  const env = { MQTT_URL: 'mqtt://h:1883', MQTT_UTILISATEUR: 'bob', MQTT_MOT_DE_PASSE: 'pw', DOMOTIQUE_MQTT_MOT_DE_PASSE: '', EXPORT_JETON: 't', ADMIN_MOT_DE_PASSE: 'c', SECRET_SESSION: 's', PORT: '8095' };
  const copy = { ...env };
  const r = redact(env);
  assert.deepEqual(env, copy);
  assert.equal(r.MQTT_URL, 'mqtt://h:1883');
  assert.equal(r.PORT, '8095');
  assert.equal(r.MQTT_UTILISATEUR, '***');
  assert.equal(r.MQTT_MOT_DE_PASSE, '***');
  assert.equal(r.DOMOTIQUE_MQTT_MOT_DE_PASSE, '', 'empty stays visibly empty');
  assert.equal(r.EXPORT_JETON, '***');
  assert.equal(r.ADMIN_MOT_DE_PASSE, '***');
  assert.equal(r.SECRET_SESSION, '***');
});

test('redact removes credentials embedded in URLs under any key', () => {
  assert.equal(redact({ X: 'mqtts://user:pass@host:8883/path' }).X, 'mqtts://***@host:8883/path');
  assert.equal(redactText('see postgres://carte:secret@db:5432/carte and mqtt://u@h'), 'see postgres://***@db:5432/carte and mqtt://***@h');
  assert.deepEqual(redact(null), {});
});
