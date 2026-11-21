// Preparation of the persistent data directory.
//
// The Supervisor creates /data owned by root; upstream runs as the
// unprivileged "node" user (uid 1000). At start, while still root, ownership
// of what is there is handed to that user. Nothing is ever deleted, moved or
// recreated here.

import fs from 'node:fs';
import path from 'node:path';

// Written by the Supervisor for this App's startup code only; upstream has no
// use for it, so it stays as the Supervisor made it.
export const KEEP_AS_IS = new Set(['options.json']);

// Lists every entry below dir (dir included) whose owner differs from
// uid:gid. Symbolic links are listed themselves and never followed.
export function findForeignOwned(dir, uid, gid, { fsImpl = fs, keep = KEEP_AS_IS } = {}) {
  const found = [];
  const visit = (p, top) => {
    let st;
    try { st = fsImpl.lstatSync(p); } catch { return; }
    if (st.uid !== uid || st.gid !== gid) found.push(p);
    if (!st.isDirectory()) return;
    let names;
    try { names = fsImpl.readdirSync(p); } catch { return; }
    for (const n of names) {
      if (top && keep.has(n)) continue;
      visit(path.join(p, n), false);
    }
  };
  visit(dir, true);
  return found;
}

// Returns { changed, failed } counts. Requires root to change anything.
export function takeOwnership(dir, uid, gid, { fsImpl = fs } = {}) {
  let changed = 0, failed = 0;
  for (const p of findForeignOwned(dir, uid, gid, { fsImpl })) {
    try { fsImpl.lchownSync(p, uid, gid); changed++; } catch { failed++; }
  }
  return { changed, failed };
}

// True when the current user can create and remove a file in dir.
export function isWritable(dir, { fsImpl = fs } = {}) {
  const probe = path.join(dir, `.lmm-write-test-${process.pid}`);
  try {
    fsImpl.writeFileSync(probe, '');
    fsImpl.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
