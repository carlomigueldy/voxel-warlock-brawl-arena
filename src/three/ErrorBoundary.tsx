// Minimal class-based error boundary — React has no built-in one. Used by
// <PlayerEntity> (design §6) to catch a GLB load/parse failure from
// <WarlockBody> (drei's useGLTF throwing inside <Suspense>, or any runtime
// error while building the per-instance clone) and fall back to
// <VoxelWarlockBody>, mirroring legacy renderer.js's `usingGLB=false` path
// (buildCharacterInstance returning null when the template isn't ready).
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- surfaced for diagnosis; the UI
    // itself degrades gracefully to the voxel fallback below.
    console.error("[WarlockBody] GLB path failed, falling back to voxel body:", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
