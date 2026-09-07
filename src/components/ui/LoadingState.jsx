export default function LoadingState({ label = 'Loading SportsTech...', error, onRetry }) {
    return (
        <div className="min-h-64 flex flex-col items-center justify-center gap-4 p-6 text-center text-slate-300" role={error ? 'alert' : 'status'}>
            <p>{error ? `Unable to load data: ${error}` : label}</p>
            {onRetry && <button type="button" onClick={onRetry} className="btn-primary">Retry</button>}
        </div>
    );
}
