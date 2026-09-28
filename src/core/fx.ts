/**
 * Sequencer commands, after the M8 operation manual's appendix. Where the manual leaves
 * details to the on-screen help (NTH, RND ranges), the rule used here is spelled out in
 * `help`, which the inspector shows.
 */

export type FxKind = 'sequencer' | 'instrument' | 'mixer';

export interface FxDef {
  code: string;
  name: string;
  kind: FxKind;
  /** Value reads as a signed byte (80–FF negative). */
  signed?: boolean;
  /** Value is two nibbles, x and y. */
  nibbles?: boolean;
  help: string;
}

const seq = (code: string, name: string, help: string, extra: Partial<FxDef> = {}): FxDef => ({
  code,
  name,
  kind: 'sequencer',
  help,
  ...extra,
});
const ins = (code: string, name: string, help: string, extra: Partial<FxDef> = {}): FxDef => ({
  code,
  name,
  kind: 'instrument',
  help,
  ...extra,
});
const mix = (code: string, name: string, help: string, extra: Partial<FxDef> = {}): FxDef => ({
  code,
  name,
  kind: 'mixer',
  help,
  ...extra,
});

const REL = 'Relative: 01–7F add, 80–FF subtract, until the next note with an instrument.';

export const FX: FxDef[] = [
  seq('ARP', 'Arpeggio', 'Rapid 3-note arpeggio: the note, +x and +y semitones. ARP 00 stops.', { nibbles: true }),
  seq('ARC', 'Arp config', 'x = mode (0 up, 1 down, 2 up-down, 3 random), y = ticks per note.', { nibbles: true }),
  seq('CHA', 'Chance', 'Phrase: x = chance of everything left of it, y = chance of the commands right of it (0 never … F always). Table: chance of the row left of it, 00–FF.', { nibbles: true }),
  seq('DEL', 'Delay', 'Phrase: delay the whole row by xx ticks. Table: hold the table for xx ticks.'),
  seq('GRV', 'Groove', 'Switch this track to groove xx.'),
  seq('GGR', 'Global groove', 'Switch every track to groove xx.'),
  seq('HOP', 'Hop', 'Phrase: after this row, go to row y of the next phrase. HOP FF stops the track. Table: jump to row y, x times (x = 0: always).', { nibbles: true }),
  seq('INS', 'Instrument', 'Play the current note with instrument xx (or set it for this row).'),
  seq('KIL', 'Kill', 'Cut the note after xx ticks.'),
  seq('OFF', 'Note off', 'Release the note after xx ticks: an ADSR goes to its release stage.'),
  seq('NTH', 'Nth pass', 'Left side plays on the first of every x passes of this phrase, right side on the first of every y (0 or 1 = always).', { nibbles: true }),
  seq('NXT', 'Next track', 'Play instrument xx with this note and velocity on the track to the right.'),
  seq('RET', 'Retrigger', 'y ≠ 0: retrigger every y ticks; x 0–7 lowers, 8–F raises the volume each time. y = 0: one retrigger after x ticks.', { nibbles: true }),
  seq('REP', 'Repeat', 'Repeat the last command on every following row, adding xx (signed) each row. REP 00 or a new command stops it.', { signed: true }),
  seq('RTO', 'Repeat to', 'Limit for REP: it stops changing at xx.'),
  seq('RND', 'Random', 'Re-run the previously active command with a randomised value: x adds up to x to its first digit, y up to y to its second.', { nibbles: true }),
  seq('RNL', 'Random left', 'In FX1: randomise the note by ±x semitones and the instrument by +0…y. Elsewhere: randomise the value of the command just left of it (x first digit, y second).', { nibbles: true }),
  seq('SCA', 'Track scale', 'Snap this track’s notes to a scale: x = key (0 C … B B), y = scale (0 chromatic, 1 major, 2 minor, 3 dorian, 4 phrygian, 5 mixolydian, 6 harmonic minor, 7 pentatonic major, 8 pentatonic minor, 9 blues, A–F user scales 0–5 from the Scale view, with their tuning).', { nibbles: true }),
  seq('SCG', 'Global scale', 'Like SCA, for every track.', { nibbles: true }),
  seq('PSL', 'Pitch slide', 'Portamento from the previous note over xx ticks.'),
  seq('PBN', 'Pitch bend', 'Continuous bend: 01–7F up, 80–FF down, cents per tick. PBN 00 holds.', { signed: true }),
  seq('PVB', 'Vibrato', 'Vibrato: x speed, y depth. PVB 00 stops.', { nibbles: true }),
  seq('PVX', 'Wide vibrato', 'Vibrato with a much wider rate and depth range.', { nibbles: true }),
  seq('RMX', 'Remix', 'Move the phrase playhead of tracks to the left to row y: x = how many tracks (0 = all to the left).', { nibbles: true }),
  seq('SED', 'Seed', 'Seed this track’s random numbers with xx, so RND, RNL and CHA repeat exactly.'),
  seq('SNG', 'Song hop', 'After this row, move the track xx rows up (80–FF) or down (01–7F) in the song.', { signed: true }),
  seq('TBL', 'Table', 'Run table xx with this note instead of the instrument’s own table.'),
  seq('TBX', 'Aux table', 'Run table xx alongside the instrument table on this track. TBX 00 stops it.'),
  seq('THO', 'Table hop', 'Jump the running table to row 0x.'),
  seq('TIC', 'Table tick', 'Table speed: 01–FB ticks per row, 00 one row per note, FC octave map, FD velocity map, FE note map, FF 200 rows/s.'),
  seq('TPO', 'Tempo', 'Set the tempo to xx BPM.'),
  seq('TSP', 'Song transpose', 'Transpose the whole song by xx semitones (same as TRANSPOSE in Project).', { signed: true }),
  ins('VOL', 'Volume', `Offset the volume. ${REL}`, { signed: true }),
  ins('PIT', 'Pitch', `Offset the pitch in semitones. ${REL}`, { signed: true }),
  ins('FIN', 'Fine tune', `Offset the pitch by up to ±1 semitone. ${REL}`, { signed: true }),
  ins('CUT', 'Cutoff', `Offset the filter cutoff. ${REL}`, { signed: true }),
  ins('RES', 'Resonance', `Offset the filter resonance. ${REL}`, { signed: true }),
  ins('AMP', 'Amp', `Offset the drive into the limiter. ${REL}`, { signed: true }),
  ins('PAN', 'Pan', `Offset the pan. ${REL}`, { signed: true }),
  ins('SCH', 'Chorus send', `Offset the chorus send. ${REL}`, { signed: true }),
  ins('SDL', 'Delay send', `Offset the delay send. ${REL}`, { signed: true }),
  ins('SRV', 'Reverb send', `Offset the reverb send. ${REL}`, { signed: true }),
  ins('EA1', 'Env 1 amount', `Offset the first envelope’s amount from the next note. ${REL}`, { signed: true }),
  ins('AT1', 'Env 1 attack', `Offset the first envelope’s attack. ${REL}`, { signed: true }),
  ins('DE1', 'Env 1 decay', `Offset the first envelope’s decay. ${REL}`, { signed: true }),
  ins('HO1', 'Env 1 hold', `Offset the first envelope’s hold. ${REL}`, { signed: true }),
  ins('ET1', 'Env 1 retrigger', 'Restart the first envelope of the playing note (any value above 00).'),
  ins('EA2', 'Env 2 amount', `Offset the second envelope’s amount. ${REL}`, { signed: true }),
  ins('AT2', 'Env 2 attack', `Offset the second envelope’s attack. ${REL}`, { signed: true }),
  ins('HO2', 'Env 2 hold', `Offset the second envelope’s hold. ${REL}`, { signed: true }),
  ins('DE2', 'Env 2 decay', `Offset the second envelope’s decay. ${REL}`, { signed: true }),
  ins('LA1', 'LFO amount', `Offset the first LFO’s amount. ${REL}`, { signed: true }),
  ins('ET2', 'Env 2 retrigger', 'Restart the second envelope of the playing note (any value above 00).'),
  ins('LF1', 'LFO freq', `Offset the first LFO’s frequency. ${REL}`, { signed: true }),
  ins('LT1', 'LFO retrigger', 'Restart the first LFO of the playing note at phase xx.'),
  ins('LA2', 'LFO 2 amount', `Offset the second LFO’s amount. ${REL}`, { signed: true }),
  ins('LF2', 'LFO 2 freq', `Offset the second LFO’s frequency. ${REL}`, { signed: true }),
  ins('LT2', 'LFO 2 retrigger', 'Restart the second LFO of the playing note at phase xx.'),
  ins('SIZ', 'Wav size', `WAVSYNTH: offset SIZE, live on the playing note. ${REL}`, { signed: true }),
  ins('MUL', 'Wav mult', `WAVSYNTH: offset MULT from the next note. ${REL}`, { signed: true }),
  ins('WRP', 'Wav warp', `WAVSYNTH: offset WARP, live on the playing note. ${REL}`, { signed: true }),
  ins('SCN', 'Wav scan', `WAVSYNTH: offset SCAN (mirror, or the wave-table frame on WT shapes), live on the playing note — run it from a table to sweep. ${REL}`, { signed: true }),
  ins('STA', 'Sample start', `SAMPLER: offset START from the next note. ${REL}`, { signed: true }),
  ins('LEN', 'Sample length', `SAMPLER: offset LENGTH from the next note. ${REL}`, { signed: true }),
  ins('LOP', 'Loop start', `SAMPLER: offset LOOP ST from the next note. ${REL}`, { signed: true }),
  ins('SLI', 'Slice', 'SAMPLER with SLICES: play slice xx with this note, whatever the note.'),
  ins('FMA', 'Op A level', `FMSYNTH: offset operator A’s level, live. ${REL}`, { signed: true }),
  ins('FMB', 'Op B level', `FMSYNTH: offset operator B’s level. ${REL}`, { signed: true }),
  ins('FMC', 'Op C level', `FMSYNTH: offset operator C’s level. ${REL}`, { signed: true }),
  ins('FMD', 'Op D level', `FMSYNTH: offset operator D’s level. ${REL}`, { signed: true }),
  ins('SWM', 'Swarm', `HYPERSYNTH: offset SWARM from the next note. ${REL}`, { signed: true }),
  ins('WID', 'Width', `HYPERSYNTH: offset WIDTH from the next note. ${REL}`, { signed: true }),
  ins('EQI', 'Instrument EQ', 'Use EQ slot xx for this track’s instrument from the next note.'),
  mix('EQM', 'Main EQ', 'Switch the main mix EQ to slot xx.'),
  mix('VMV', 'Main volume', 'Set the main volume.'),
  mix('DJF', 'DJ filter', 'DJ filter cutoff: 80 off, lower low-pass, higher high-pass.'),
  mix('DJC', 'DJ cutoff', 'Same as DJF: DJ filter cutoff.'),
  mix('DJR', 'DJ resonance', 'DJ filter resonance.'),
  mix('DJT', 'DJ type', 'DJ filter type: 00 LP/HP, 01 LP/BS, 02 BS/HP.'),
  mix('VCH', 'Chorus volume', 'Chorus return level.'),
  mix('VDE', 'Delay volume', 'Delay return level.'),
  mix('VRE', 'Reverb volume', 'Reverb return level.'),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => mix(`VT${n}`, `Track ${n} volume`, `Set track ${n}’s mixer volume.`)),
  mix('XCM', 'Chorus depth', 'Chorus modulation depth.'),
  mix('XCF', 'Chorus rate', 'Chorus modulation frequency.'),
  mix('XCW', 'Chorus width', 'Chorus stereo width.'),
  mix('XCR', 'Chorus → reverb', 'Chorus to reverb send.'),
  mix('XDT', 'Delay time', 'Delay times: x left, y right, in 16-tick steps.', { nibbles: true }),
  mix('XDF', 'Delay feedback', 'Delay feedback.'),
  mix('XDW', 'Delay width', 'Delay stereo width.'),
  mix('XDR', 'Delay → reverb', 'Delay to reverb send.'),
  mix('XRS', 'Reverb size', 'Reverb room size.'),
  mix('XRD', 'Reverb decay', 'Reverb decay (damping).'),
  mix('XRW', 'Reverb width', 'Reverb stereo width.'),
  mix('XRM', 'Reverb mod depth', 'Reverb modulation depth.'),
  mix('XRF', 'Reverb mod freq', 'Reverb modulation frequency.'),
  mix('XRZ', 'Reverb freeze', 'Freeze the reverb while above 00.'),
];

/** Instrument commands that only mean something for one instrument type (M8 lists per type). */
export const FX_FOR_TYPE: Record<string, string> = {
  SIZ: 'WAVSYNTH',
  MUL: 'WAVSYNTH',
  WRP: 'WAVSYNTH',
  SCN: 'WAVSYNTH',
  STA: 'SAMPLER',
  LEN: 'SAMPLER',
  LOP: 'SAMPLER',
  SLI: 'SAMPLER',
  FMA: 'FMSYNTH',
  FMB: 'FMSYNTH',
  FMC: 'FMSYNTH',
  FMD: 'FMSYNTH',
  SWM: 'HYPERSYNTH',
  WID: 'HYPERSYNTH',
};

export const FX_CODES = FX.map((f) => f.code);
export const FX_BY_CODE: Record<string, FxDef> = Object.fromEntries(FX.map((f) => [f.code, f]));

export const toSigned = (v: number) => (v >= 128 ? v - 256 : v);
export const fromSigned = (v: number) => (v < 0 ? v + 256 : v) & 0xff;
