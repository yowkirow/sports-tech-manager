import { AlertTriangle } from 'lucide-react';

export default function LoadingState({ label = 'Loading SportsTech…', error, onRetry }) {
    if (error) {
        return (
            <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
                <AlertTriangle size={28} className="text-amber-400" aria-hidden="true" />
                <div className="max-w-sm">
                    <p className="font-semibold text-ink">Unable to load data</p>
                    <p className="mt-1 text-sm text-ink-2">{error}</p>
                </div>
                {onRetry && <button type="button" onClick={onRetry} className="btn-primary">Try again</button>}
            </div>
        );
    }
    return (
        <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center text-ink-2">
            <span className="size-8 animate-spin rounded-full border-2 border-slate-700 border-t-primary" aria-hidden="true" />
            <p className="text-sm">{label}</p>
            {onRetry && <button type="button" onClick={onRetry} className="btn-secondary">Try again</button>}
        </div>
    );
}
