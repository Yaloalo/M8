import { Component, type ReactNode } from 'react';
import { newProject } from '../core/factory';
import { withBuiltins } from '../state/boot';
import { demoProject } from '../state/demo';
import { pauseAutosave } from '../state/persist';
import { replaceProject, undo } from '../state/store';

/**
 * If a screen throws, show a way out instead of a blank page, and stop autosaving so a
 * project that crashes the app is not written over the last good copy.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    pauseAutosave(true);
    return { error };
  }

  private recover(fn: () => void) {
    fn();
    pauseAutosave(false);
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="workspace">
        <section className="panel crash" role="alert">
          <header className="panel-heading">
            <span className="small-label">Something broke</span>
          </header>
          <div className="panel-body">
            <p>
              This screen hit an error: <code>{this.state.error.message}</code>. Autosave is paused, so
              the last saved copy is untouched.
            </p>
            <div className="panel-tools">
              <button className="primary" onClick={() => this.recover(undo)}>
                Undo the last change
              </button>
              <button onClick={() => this.recover(() => replaceProject(withBuiltins(demoProject())))}>Load demo</button>
              <button className="danger" onClick={() => this.recover(() => replaceProject(withBuiltins(newProject())))}>
                New project
              </button>
              <button onClick={() => location.reload()}>Reload</button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
