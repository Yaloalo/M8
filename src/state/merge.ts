/**
 * Three-way merge for two tabs editing one project.
 *
 * `base` is the version both tabs last agreed on, `local` this tab's current project and
 * `remote` what the other tab just saved. Everything this tab did not touch is taken from
 * the remote; what it did change is kept. Because edits go through immer, an untouched
 * subtree of `local` is the very same object as in `base`, so "unchanged here" is an
 * identity check and the merge only descends into the parts this tab edited. When both tabs
 * changed the same value, this tab's value wins.
 */
export function merge3<T>(base: T, local: T, remote: T): T {
  if (local === base) return remote;
  if (!isContainer(base) || !isContainer(local) || !isContainer(remote)) return local;
  if (Array.isArray(local) !== Array.isArray(remote) || Array.isArray(local) !== Array.isArray(base)) return local;
  if (Array.isArray(local)) {
    const b = base as unknown[];
    const r = remote as unknown[];
    // Arrays of different length (a chord gained a note) are not merged item by item.
    if (local.length !== b.length || r.length !== b.length) return local;
    return local.map((v, i) => merge3(b[i], v, r[i])) as T;
  }
  const b = base as Record<string, unknown>;
  const l = local as Record<string, unknown>;
  const r = remote as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const inB = k in b;
    const inL = k in l;
    if (inB && !inL) continue; // deleted here
    if (!inB && inL) {
      out[k] = l[k]; // added here
      continue;
    }
    if (!inB && !inL) {
      out[k] = r[k]; // added there
      continue;
    }
    if (!(k in r)) {
      // Deleted there: keep it only if this tab changed it.
      if (l[k] !== b[k]) out[k] = l[k];
      continue;
    }
    out[k] = merge3(b[k], l[k], r[k]);
  }
  return out as T;
}

const isContainer = (v: unknown): v is object => typeof v === 'object' && v !== null;
