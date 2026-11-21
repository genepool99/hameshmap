'use strict';
// Makes `node --test tests/unit/` work on Node.js 22 and later, where a
// directory argument is loaded as a module instead of being searched for
// test files. Loads every *.test.mjs file of this directory.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const name of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, name)).href);
}
