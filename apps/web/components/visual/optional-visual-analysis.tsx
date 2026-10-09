'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode } from 'react';

const Panel = dynamic(() => import('./visual-analysis-panel'), { ssr: false });

class Isolate extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Mount point for the room. A failure in the camera module renders nothing and never reaches the interview. */
export function OptionalVisualAnalysis() {
  return (
    <Isolate>
      <Panel />
    </Isolate>
  );
}
