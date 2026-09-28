import { useEffect } from 'react';
import { midiOutputNames } from './state/transport';
import { setMidiOutputs } from './state/fields';
import { useStore } from './state/store';
import { Header } from './ui/Header';
import { Screen } from './ui/Screens';
import { Transport } from './ui/Transport';
import { Tour } from './ui/Tour';
import { FxPicker } from './ui/FxPicker';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useKeyboard } from './ui/useKeyboard';
import './tracker.css';
import './ui/renderSelection';

export default function App() {
  useKeyboard();
  const view = useStore((s) => s.view);
  useEffect(() => {
    // Asking for MIDI can prompt, so only do it where it is needed.
    if (view === 'PROJECT') void midiOutputNames().then(setMidiOutputs);
  }, [view]);
  // Two nets: a screen that throws keeps the header and transport; anything else that throws
  // still gets the recovery panel instead of a blank page.
  return (
    <ErrorBoundary>
      <Header />
      <ErrorBoundary>
        <main className="workspace">
          <Screen />
        </main>
      </ErrorBoundary>
      <Transport />
      <Tour />
      <FxPicker />
    </ErrorBoundary>
  );
}
