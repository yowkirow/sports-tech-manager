import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZES = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
};

/**
 * Accessible modal surface. `center` is a dialog on wide screens and a bottom sheet on phones;
 * `drawer` slides in from the right on wide screens and fills the screen on phones.
 */
export default function Dialog({
    onClose,
    title,
    description,
    children,
    footer,
    variant = 'center',
    size = 'md',
    className,
    bodyClassName,
    headerExtra,
    closeLabel = 'Close',
    initialFocusRef,
}) {
    const panelRef = useRef(null);
    const titleId = useId();
    const descriptionId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        const panel = panelRef.current;
        const target = initialFocusRef?.current || panel?.querySelector('[data-autofocus]') || panel;
        target?.focus({ preventScroll: true });

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onCloseRef.current?.();
                return;
            }
            if (event.key !== 'Tab' || !panel) return;
            const items = [...panel.querySelectorAll(FOCUSABLE)].filter(node => node.offsetParent !== null);
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = overflow;
            if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
        };
    }, [initialFocusRef]);

    const isDrawer = variant === 'drawer';

    return createPortal(
        <div className={clsx('fixed inset-0 z-[80] flex', isDrawer ? 'justify-end' : 'items-end justify-center sm:items-center sm:p-6')}>
            <div className="absolute inset-0 animate-fade-in bg-black/75" onClick={() => onCloseRef.current?.()} aria-hidden="true" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className={clsx(
                    'relative flex w-full flex-col overflow-hidden border-line bg-surface text-ink shadow-sheet outline-none animate-slide-up',
                    isDrawer
                        ? 'h-dvh border-l sm:max-w-md'
                        : clsx('max-h-[92dvh] rounded-t-2xl border-t sm:max-h-[88dvh] sm:rounded-2xl sm:border', SIZES[size] || SIZES.md),
                    className
                )}
            >
                {(title || headerExtra) && (
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
                        <div className="min-w-0">
                            {title && <h2 id={titleId} className="display text-2xl">{title}</h2>}
                            {description && <p id={descriptionId} className="mt-1 text-sm text-ink-2">{description}</p>}
                        </div>
                        <div className="-mr-2 -mt-1 flex items-center gap-1">
                            {headerExtra}
                            <button type="button" onClick={() => onCloseRef.current?.()} className="icon-btn" aria-label={closeLabel}>
                                <X size={22} />
                            </button>
                        </div>
                    </div>
                )}
                <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'p-5')}>
                    {children}
                </div>
                {footer && (
                    <div className="shrink-0 border-t border-line bg-surface px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
