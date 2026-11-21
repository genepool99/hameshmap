import test from 'node:test';
import assert from 'node:assert/strict';
import { overriddenByMapSettings } from '../../live-mesh-map/rootfs/opt/lmm/config.mjs';

const env = { DOMOTIQUE_ENVOI_LORA: 'non', DOMOTIQUE_RACINE: 'live-mesh-map', MQTT_TLS_NON_VERIFIE: 'non' };

test('no saved settings: nothing is overridden', () => {
  assert.deepEqual(overriddenByMapSettings(env, null), []);
  assert.deepEqual(overriddenByMapSettings(env, {}), []);
  assert.deepEqual(overriddenByMapSettings(env, { variables: [] }), []);
  assert.deepEqual(overriddenByMapSettings(env, { variables: 'x' }), []);
});

test('saved settings with a different value are reported by name, sorted', () => {
  const settings = { variables: { MQTT_TLS_NON_VERIFIE: 'oui', DOMOTIQUE_ENVOI_LORA: 'oui' } };
  assert.deepEqual(overriddenByMapSettings(env, settings), ['DOMOTIQUE_ENVOI_LORA', 'MQTT_TLS_NON_VERIFIE']);
});

test('identical values, null values and variables the App does not set are ignored', () => {
  const settings = { variables: { DOMOTIQUE_RACINE: 'live-mesh-map', DOMOTIQUE_ENVOI_LORA: null, SEUIL_ACTIF_MINUTES: 30 } };
  assert.deepEqual(overriddenByMapSettings(env, settings), []);
});
