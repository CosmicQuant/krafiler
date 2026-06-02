/**
 * ErrorBoundary.tsx
 *
 * React class component that catches JavaScript errors anywhere in its child
 * component tree and displays a fallback UI instead of crashing the entire app.
 */

import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: undefined });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                            <AlertTriangle className="h-8 w-8 text-[#ff0613]" />
                        </div>
                        <h2 className="mt-5 text-xl font-bold text-slate-900">
                            Something went wrong
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            An unexpected error occurred. Try refreshing the page or go back home.
                        </p>
                        {this.state.error && (
                            <div className="mt-4 rounded-lg bg-slate-100 p-3 text-left">
                                <p className="text-xs font-mono text-slate-600 break-all">
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}
                        <div className="mt-6 flex items-center justify-center gap-3">
                            <button
                                onClick={() => window.location.reload()}
                                className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#d80000] transition"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Refresh Page
                            </button>
                            <button
                                onClick={() => {
                                    this.handleReset();
                                    window.location.href = '/';
                                }}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                                <Home className="h-4 w-4" />
                                Go Home
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
