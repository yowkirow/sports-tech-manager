import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { api } from '../../lib/apiClient';
import { NumberField, heightOf, inches } from './fields';

/** Renames or resizes a saved design, or deletes it from the gallery. */
export default function EditDesignDialog({ design, file, onClose, onSaved, onDeleted }) {
    const [name, setName] = useState(design.name);
    const [widthIn, setWidthIn] = useState(design.widthIn);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const heightIn = heightOf(widthIn, design);
    const trimmed = name.replace(/\s+/g, ' ').trim();
    const changes = {
        ...(trimmed !== design.name ? { name: trimmed } : {}),
        ...(widthIn !== design.widthIn ? { widthIn, heightIn } : {})
    };
    const invalid = !trimmed ? 'Give the design a name.' : heightIn < 0.1 ? 'At this width the design is too thin to print.'
        : heightIn > 120 ? 'At this width the design is too tall.' : '';

    const run = async action => {
        setBusy(true);
        setError('');
        try { await action(); }
        catch (failure) { setError(failure.message || 'That didn\'t work. Try again.'); setBusy(false); }
    };
    const save = () => run(async () => {
        if (!Object.keys(changes).length) { onClose(); return; }
        const { design: saved } = await api.dtf.update(design.id, changes);
        onSaved(saved);
    });
    const remove = () => {
        if (!window.confirm(`Delete “${design.name}” from your designs? It also comes off this sheet.`)) return;
        run(async () => {
            await api.dtf.remove(design.id);
            onDeleted(design.id);
        });
    };

    return (
        <Dialog
            onClose={() => { if (!busy) onClose(); }}
            title="Edit design"
            description="The print width is the size it starts at when you add it to a sheet. Prints already on the sheet keep theirs."
            footer={(
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={remove} disabled={busy} className="btn-danger">
                        <Trash2 size={17} aria-hidden="true" /> Delete design
                    </button>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
                        <button type="button" onClick={save} disabled={busy || Boolean(invalid)} className="btn-primary">{busy ? 'Saving…' : 'Save'}</button>
                    </div>
                </div>
            )}
        >
            <div className="space-y-4">
                <div className="dtf-film relative mx-auto aspect-square w-full max-w-56 overflow-hidden rounded-xl">
                    {file?.status === 'ready' && <img src={file.url} alt="" draggable={false} className="absolute inset-0 size-full object-contain p-4" />}
                </div>
                <div>
                    <label htmlFor="dtf-edit-name" className="field-label">Name</label>
                    <input id="dtf-edit-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} className="field" autoComplete="off" data-autofocus />
                </div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <NumberField label="Print width" value={widthIn} min={0.1} max={60} className="w-32" onChange={setWidthIn} />
                    <p className="num pb-3 text-sm text-ink-2">× {inches(heightIn)} in tall</p>
                </div>
                {(invalid || error) && <p role="alert" className="text-sm text-red-300">{error || invalid}</p>}
            </div>
        </Dialog>
    );
}
