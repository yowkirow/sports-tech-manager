import React from 'react';

// "Did you mean juan@gmail.com?" under an email field, from suggestEmailFix. The live region stays
// mounted so screen readers hear the suggestion when it appears.
export default function EmailFixHint({ suggestion, onUse }) {
    return (
        <div aria-live="polite">
            {suggestion && (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-2">
                    <span className="min-w-0 break-words">Did you mean <span className="font-semibold text-ink">{suggestion}</span>?</span>
                    <button type="button" className="min-h-11 font-semibold text-ink underline underline-offset-4 hover:text-white"
                        onClick={() => onUse(suggestion)}>
                        Use this
                    </button>
                </p>
            )}
        </div>
    );
}
