import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/apiClient';
import { SHEET_DEFAULTS, layoutSheets, sheetSettings } from '../../lib/dtfLayout.js';
import { download, renderSheetPng, sheetFileName } from '../../lib/dtfExport.js';
import { useToast } from '../ui/Toast';
import { useReadOnly } from '../ui/ReadOnly';
import LoadingState from '../ui/LoadingState';
import { forgetDesignFile, rememberDesignFile, useDesignFiles } from './designFiles';
import { heightOf } from './fields';
import DesignGallery from './DesignGallery';
import SheetPicks from './SheetPicks';
import SheetPreview from './SheetPreview';
import UploadDesignsDialog from './UploadDesignsDialog';
import EditDesignDialog from './EditDesignDialog';

// DTF sheets (owner request 2026-11-09): pick saved SVG designs, see them placed on the supplier's
// 22 x 39 in sheet with the spacing shared out evenly, and download one 300 DPI PNG per sheet.
// What's on the sheet and its settings stay on this device between visits.
const PICKS_KEY = 'sportstech:dtf-picks';
const SETTINGS_KEY = 'sportstech:dtf-sheet';
const MAX_COPIES = 999;

function stored(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); }
    catch { return null; }
}

function keep(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* Private browsing or full storage: the sheet still works for this visit. */ }
}

const validPick = pick => pick && typeof pick.key === 'string' && typeof pick.designId === 'string'
    && Number.isFinite(pick.widthIn) && pick.widthIn >= 0.1 && pick.widthIn <= 60
    && Number.isInteger(pick.quantity) && pick.quantity >= 1 && pick.quantity <= MAX_COPIES;
const byName = (left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id);

export default function DtfSheets() {
    const { showToast } = useToast();
    const readOnly = useReadOnly();
    const [designs, setDesigns] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [picks, setPicks] = useState(() => {
        const saved = stored(PICKS_KEY);
        return Array.isArray(saved) ? saved.filter(validPick) : [];
    });
    const [settings, setSettings] = useState(() => sheetSettings(stored(SETTINGS_KEY) ?? SHEET_DEFAULTS));
    const [uploads, setUploads] = useState(null);
    const [editing, setEditing] = useState(null);
    const [exporting, setExporting] = useState(null);
    const stopExport = useRef(null);
    const { files, retry } = useDesignFiles(designs);

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const { designs: list } = await api.dtf.list();
            setDesigns([...list].sort(byName));
        } catch (error) {
            setLoadError(error.message || 'Your designs could not be loaded.');
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { keep(PICKS_KEY, picks); }, [picks]);
    useEffect(() => { keep(SETTINGS_KEY, settings); }, [settings]);
    useEffect(() => () => stopExport.current?.abort(), []);

    const designsById = useMemo(() => new Map((designs || []).map(design => [design.id, design])), [designs]);
    // A pick whose design left the gallery (on another device, say) drops off once the gallery is known.
    useEffect(() => {
        if (!designs) return;
        setPicks(current => {
            const kept = current.filter(pick => designsById.has(pick.designId));
            return kept.length === current.length ? current : kept;
        });
    }, [designs, designsById]);

    const sheetPicks = useMemo(() => picks.filter(pick => designsById.has(pick.designId)).map(pick => {
        const design = designsById.get(pick.designId);
        return { ...pick, name: design.name, heightIn: heightOf(pick.widthIn, design), ratio: design.heightIn / design.widthIn };
    }), [picks, designsById]);
    const layout = useMemo(() => layoutSheets(sheetPicks, settings), [sheetPicks, settings]);
    const counts = useMemo(() => {
        const totals = new Map();
        for (const pick of sheetPicks) totals.set(pick.designId, (totals.get(pick.designId) || 0) + pick.quantity);
        return totals;
    }, [sheetPicks]);

    const addPick = design => setPicks(current => {
        const same = current.find(pick => pick.designId === design.id && pick.widthIn === design.widthIn);
        if (same) return current.map(pick => (pick === same ? { ...pick, quantity: Math.min(MAX_COPIES, pick.quantity + 1) } : pick));
        return [...current, { key: `${design.id}:${crypto.randomUUID().slice(0, 8)}`, designId: design.id, widthIn: design.widthIn, quantity: 1 }];
    });
    const changePick = (key, changes) => setPicks(current => current.map(pick => (pick.key === key ? { ...pick, ...changes } : pick)));
    const removePick = key => setPicks(current => current.filter(pick => pick.key !== key));

    const exportSheets = async indexes => {
        const svgs = new Map();
        for (const index of indexes) {
            for (const item of layout.sheets[index].placements) {
                const file = files.get(item.designId);
                if (file?.status !== 'ready') {
                    showToast('Some designs are still loading. Try again in a moment.', 'error');
                    return;
                }
                svgs.set(item.designId, file.svg);
            }
        }
        const controller = new AbortController();
        stopExport.current = controller;
        const sheets = layout.sheets;
        const sizes = layout.settings;
        try {
            for (const [position, index] of indexes.entries()) {
                setExporting({ index, position, count: indexes.length, progress: 0 });
                const blob = await renderSheetPng({
                    sheet: sheets[index], settings: sizes, designs: svgs, signal: controller.signal,
                    onProgress: progress => setExporting(current => current && { ...current, progress })
                });
                download(blob, sheetFileName({ index, count: sheets.length, widthIn: sizes.widthIn, lengthIn: sizes.lengthIn }));
            }
            showToast(indexes.length > 1 ? `Saved ${indexes.length} sheet files` : 'Sheet file saved', 'success');
        } catch (error) {
            if (error?.name === 'AbortError') showToast('Stopped. No file was saved for that sheet.', 'info');
            else showToast(error.message || 'The sheet file could not be made.', 'error', 6000);
        } finally {
            stopExport.current = null;
            setExporting(null);
        }
    };

    if (!designs) {
        return loadError ? <LoadingState error={loadError} onRetry={load} /> : <LoadingState label="Loading your designs…" />;
    }

    const usableWidthIn = layout.settings.widthIn - 2 * layout.settings.marginIn;
    const usableLengthIn = layout.settings.lengthIn - 2 * layout.settings.marginIn;
    // The shell's bottom padding stops at its full-height wrapper, so on phones this page clears the
    // 64px tab bar itself, or its last row would stay under the bar. The reading order is the phone's
    // (sheet, preview, designs); on a computer the preview stands beside the other two.
    return (
        <div className="flex flex-col gap-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[minmax(0,1fr)_min(46%,32rem)] lg:grid-rows-[auto_1fr] lg:items-start lg:pb-0">
            <SheetPicks
                className="lg:col-start-1 lg:row-start-1"
                picks={sheetPicks}
                files={files}
                layout={layout}
                settings={settings}
                onSettings={next => setSettings(sheetSettings(next))}
                onChange={changePick}
                onRemove={removePick}
                onClear={() => { if (window.confirm('Take every design off the sheet?')) setPicks([]); }}
                onFindDesigns={() => {
                    const heading = document.getElementById('dtf-designs-title');
                    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    heading?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
                    heading?.focus({ preventScroll: true });
                }}
            />
            <SheetPreview
                className="lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
                layout={layout}
                files={files}
                designsById={designsById}
                exporting={exporting}
                onExport={exportSheets}
                onCancelExport={() => stopExport.current?.abort()}
            />
            <DesignGallery
                className="lg:col-start-1 lg:row-start-2"
                designs={designs}
                files={files}
                counts={counts}
                onAdd={addPick}
                onEdit={setEditing}
                onUpload={(chosen, leftOut) => setUploads({ files: chosen, leftOut })}
                onRetry={retry}
                readOnly={readOnly}
            />

            {uploads && (
                <UploadDesignsDialog
                    files={uploads.files}
                    leftOut={uploads.leftOut}
                    usableWidthIn={usableWidthIn}
                    usableLengthIn={usableLengthIn}
                    onSaved={(design, svg) => {
                        rememberDesignFile(design.id, svg);
                        setDesigns(current => [...current.filter(item => item.id !== design.id), design].sort(byName));
                    }}
                    onClose={added => {
                        setUploads(null);
                        if (added) showToast(added === 1 ? 'Design added' : `${added} designs added`, 'success');
                    }}
                />
            )}
            {editing && (
                <EditDesignDialog
                    design={editing}
                    file={files.get(editing.id)}
                    onClose={() => setEditing(null)}
                    onSaved={design => {
                        setDesigns(current => current.map(item => (item.id === design.id ? design : item)).sort(byName));
                        setEditing(null);
                        showToast('Design saved', 'success');
                    }}
                    onDeleted={id => {
                        forgetDesignFile(id);
                        setDesigns(current => current.filter(item => item.id !== id));
                        setPicks(current => current.filter(pick => pick.designId !== id));
                        setEditing(null);
                        showToast('Design deleted', 'success');
                    }}
                />
            )}
        </div>
    );
}
