import { Component, type ReactNode } from "react";

/**
 * What's left if rendering throws, instead of React unmounting everything and leaving a blank
 * page. Dialogs are caught too: portals count as children here. Stays free of the app's model,
 * which may be what broke. Finished changes are already in the outbox, so a reload loses nothing
 * but text still being typed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state as { error: Error | null };
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Your saved work is safe. Text you were still typing may be lost.</p>
        <button className="btn primary" autoFocus onClick={() => location.reload()}>
          Reload
        </button>
        <code className="crash-detail">{error.message}</code>
      </div>
    );
  }
}
