import { effectFields, instrumentFields, mixerFields, modFields, projectFields, scaleFields, eqFields, type Field } from '../core/forms';
import type { Project } from '../core/types';
import type { State, ViewId } from './store';

let midiOutputs: string[] = [];
export const setMidiOutputs = (names: string[]) => (midiOutputs = names);

export const FORM_VIEWS: ViewId[] = ['INST', 'MODS', 'MIXER', 'EFFECTS', 'PROJECT', 'SCALE', 'EQ'];
export const isFormView = (v: ViewId) => FORM_VIEWS.includes(v);

const sampleIds = (p: Project) => Object.keys(p.samples);

/** The field list of a form screen, and the id its fields read (instrument number). */
export function formFor(s: State, view: ViewId = s.view): { fields: Field[]; id: number } {
  const p = s.project;
  switch (view) {
    case 'INST':
      return { fields: instrumentFields(p, s.ids.inst, sampleIds(p)), id: s.ids.inst };
    case 'MODS':
      return { fields: modFields(p, s.ids.inst), id: s.ids.inst };
    case 'MIXER':
      return { fields: mixerFields(), id: 0 };
    case 'EFFECTS':
      return { fields: effectFields(), id: 0 };
    case 'EQ':
      return { fields: eqFields(s.ids.eq), id: s.ids.eq };
    case 'SCALE':
      return { fields: scaleFields(p, s.ids.scale), id: s.ids.scale };
    default:
      return { fields: projectFields(midiOutputs), id: 0 };
  }
}
