/** OPTION jumps along the song and chain, and the song-screen extras (bookmarks, reorder, track time). */
import { getChain, getGroove } from '../../core/factory';
import { ROWS, TRACKS, type Project } from '../../core/types';
import { commit, getState, setState } from '../store';
import { cursor, hex, moveTo } from './cursor';

// ------------------------------------------------------------------- M8 jumps

/** CHAIN view, OPTION + ↑↓: the previous/next chain in this track's song column. */
export function jumpInSong(dir: 1 | -1) {
  const s = getState();
  const col = s.project.song.map((r) => r[s.track]);
  for (let r = s.cursors.SONG.row + dir; r >= 0 && r < col.length; r += dir) {
    if (col[r] != null) {
      setState({ ids: { ...s.ids, chain: col[r]! }, cursors: { ...s.cursors, SONG: { row: r, col: s.track } } });
      return;
    }
  }
}

/** PHRASE view, OPTION + ↑↓: the previous/next phrase in the chain. */
export function jumpInChain(dir: 1 | -1) {
  const s = getState();
  const rows = getChain(s.project, s.ids.chain).rows;
  for (let r = s.cursors.CHAIN.row + dir; r >= 0 && r < ROWS; r += dir) {
    if (rows[r].phrase != null) {
      setState({ ids: { ...s.ids, phrase: rows[r].phrase! }, cursors: { ...s.cursors, CHAIN: { row: r, col: 0 } } });
      return;
    }
  }
}

/** CHAIN/PHRASE view, OPTION + ←→: the same song row on the neighbouring track. */
export function jumpTrack(dir: 1 | -1) {
  const s = getState();
  const row = s.cursors.SONG.row;
  let t = s.track + dir;
  // In chain and phrase views an empty track has nothing to show: go on to the next track
  // with a chain on this song row, or stay put.
  if (s.view === 'CHAIN' || s.view === 'PHRASE') {
    while (t >= 0 && t < TRACKS && s.project.song[row][t] == null) t += dir;
    if (t < 0 || t >= TRACKS) {
      setState({ status: `NO CHAIN ${dir > 0 ? 'RIGHT' : 'LEFT'} OF TRACK ${s.track + 1}` });
      return;
    }
  }
  if (t < 0 || t >= TRACKS) return;
  const chain = s.project.song[row][t];
  const ids = { ...s.ids };
  if (chain != null) {
    ids.chain = chain;
    if (s.view === 'PHRASE') {
      const rows = getChain(s.project, chain).rows;
      ids.phrase = (rows[s.cursors.CHAIN.row] ?? rows[0]).phrase ?? rows.find((r) => r.phrase != null)?.phrase ?? ids.phrase;
    }
  }
  setState({ track: t, ids, cursors: { ...s.cursors, SONG: { row, col: t } }, status: `TRACK ${t + 1}` });
}

/** SONG view, OPTION + ←→: solo every track left (or right) of the cursor, itself included. */
export function soloSide(dir: 1 | -1) {
  const col = cursor().col;
  commit((d) => {
    d.mixer.solo = d.mixer.solo.map((_, t) => (dir < 0 ? t <= col : t >= col));
  });
}

// ------------------------------------------------------------------- song extras

/** OPTION × 3 on a chain: bookmark it (marked on the song screen). */
export function toggleBookmark() {
  const s = getState();
  const id = s.project.song[s.cursors.SONG.row][s.cursors.SONG.col];
  if (id == null) return;
  commit((d) => {
    d.bookmarks = d.bookmarks.includes(id) ? d.bookmarks.filter((b) => b !== id) : [...d.bookmarks, id];
  });
  setState({ status: getState().project.bookmarks.includes(id) ? `BOOKMARK ${hex(id)}` : `BOOKMARK ${hex(id)} REMOVED` });
}

/** Reorder mode: swap the cursor's track with its neighbour (song column and mixer strip). */
export function moveTrack(dir: 1 | -1) {
  const t = cursor().col;
  const o = t + dir;
  if (o < 0 || o >= TRACKS) return;
  commit((d) => {
    for (const row of d.song) [row[t], row[o]] = [row[o], row[t]];
    for (const k of ['tracks', 'mute', 'solo'] as const) {
      const a = d.mixer[k] as (number | boolean)[];
      [a[t], a[o]] = [a[o], a[t]];
    }
  });
  moveTo('SONG', cursor().row, o);
  setState({ status: `TRACK ${t + 1} → ${o + 1}` });
}

/** Ticks one track needs to play song rows from..to once (default groove timing). */
export function trackTicks(p: Project, t: number, from: number, to: number): number {
  let ticks = 0;
  const g = getGroove(p, 0).steps.filter((x): x is number => x != null);
  const perPhrase = g.length ? Array.from({ length: ROWS }, (_, i) => g[i % g.length]).reduce((a, b) => a + b, 0) : 96;
  for (let r = from; r <= to; r++) {
    const c = p.song[r][t];
    if (c == null) continue;
    const rows = getChain(p, c).rows;
    const n = rows.findIndex((x) => x.phrase == null);
    ticks += (n < 0 ? ROWS : n) * perPhrase;
  }
  return ticks;
}

/** Hold OPTION on the song screen (stopped): where the cursor row sits in the track's time. */
export function showTrackTime() {
  const s = getState();
  if (s.view !== 'SONG' || s.playing) return;
  const { row, col } = s.cursors.SONG;
  let top = row;
  while (top > 0 && s.project.song[top - 1][col] != null) top--;
  const secs = (trackTicks(s.project, col, top, row - 1) * 60) / (s.project.tempo * 24);
  const total = (trackTicks(s.project, col, top, 255) * 60) / (s.project.tempo * 24);
  const mmss = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
  setState({ status: `TRACK ${col + 1} · ROW ${hex(row)} AT ${mmss(secs)} · BLOCK ${mmss(total)}` });
}
