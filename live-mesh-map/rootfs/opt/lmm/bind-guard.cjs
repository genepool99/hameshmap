'use strict';
// Preloaded into the upstream server process (node --require).
//
// Upstream listens on all interfaces and offers no setting for the bind
// address. The ports listed in LMM_LOOPBACK_PORTS (comma-separated) are bound
// to 127.0.0.1 instead, so they cannot be reached from other containers on
// the Home Assistant network. Nothing else about the server is changed, and
// no upstream source file is modified for this.
const net = require('node:net');

const ports = new Set(String(process.env.LMM_LOOPBACK_PORTS || '').split(',').map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0));

if (ports.size) {
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function lmmListen(...args) {
    const first = args[0];
    if (typeof first === 'number' && ports.has(first)) {
      // listen(port[, host][, backlog][, callback])
      if (typeof args[1] === 'string') args[1] = '127.0.0.1';
      else args.splice(1, 0, '127.0.0.1');
    } else if (first && typeof first === 'object' && ports.has(Number(first.port))) {
      args[0] = { ...first, host: '127.0.0.1' };
    }
    return listen.apply(this, args);
  };
}
