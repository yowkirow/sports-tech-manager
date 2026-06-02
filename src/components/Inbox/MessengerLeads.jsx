import React, { useMemo, useState } from 'react';
import {
    Bot,
    Check,
    Clock,
    Edit2,
    Loader2,
    MessageCircle,
    Plus,
    RefreshCw,
    Save,
    Search,
    Trash2,
    UserRound,
    X
} from 'lucide-react';
import clsx from 'clsx';
import { LEAD_STATUSES, useMessengerLeads } from '../../hooks/useMessengerLeads';
import { useToast } from '../ui/Toast';

const emptyRule = {
    name: '',
    keywordsText: '',
    reply_text: '',
    priority: 100,
    is_active: true,
    match_type: 'contains'
};

function formatDate(value) {
    if (!value) return 'No messages yet';
    return new Date(value).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function leadName(lead) {
    return lead?.full_name || lead?.first_name || `Messenger ${lead?.psid?.slice(-6) || 'Lead'}`;
}

function keywordsToText(keywords) {
    return Array.isArray(keywords) ? keywords.join(', ') : '';
}

function textToKeywords(value) {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export default function MessengerLeads() {
    const { showToast } = useToast();
    const {
        leads,
        messages,
        rules,
        selectedLead,
        selectedLeadId,
        loading,
        messagesLoading,
        rulesLoading,
        error,
        setSelectedLeadId,
        fetchLeads,
        fetchRules,
        updateLead,
        saveRule,
        deleteRule
    } = useMessengerLeads();

    const [activeView, setActiveView] = useState('inbox');
    const [searchTerm, setSearchTerm] = useState('');
    const [leadForm, setLeadForm] = useState({ status: 'new', notes: '' });
    const [savingLead, setSavingLead] = useState(false);
    const [ruleForm, setRuleForm] = useState(emptyRule);
    const [savingRule, setSavingRule] = useState(false);

    React.useEffect(() => {
        if (selectedLead) {
            setLeadForm({
                status: selectedLead.status || 'new',
                notes: selectedLead.notes || ''
            });
        }
    }, [selectedLead]);

    const filteredLeads = useMemo(() => {
        const query = searchTerm.toLowerCase().trim();
        if (!query) return leads;

        return leads.filter(lead => {
            const haystack = [
                leadName(lead),
                lead.phone,
                lead.email,
                lead.status,
                lead.last_message_preview,
                lead.notes
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }, [leads, searchTerm]);

    const handleSaveLead = async () => {
        if (!selectedLead) return;
        setSavingLead(true);
        try {
            await updateLead(selectedLead.id, leadForm);
            showToast('Lead updated', 'success');
        } catch (err) {
            showToast(`Failed to update lead: ${err.message}`, 'error');
        } finally {
            setSavingLead(false);
        }
    };

    const handleEditRule = (rule) => {
        setRuleForm({
            ...rule,
            keywordsText: keywordsToText(rule.keywords)
        });
    };

    const handleResetRule = () => {
        setRuleForm(emptyRule);
    };

    const handleSaveRule = async (e) => {
        e.preventDefault();
        const keywords = textToKeywords(ruleForm.keywordsText || '');
        if (!ruleForm.name.trim()) return showToast('Rule name is required', 'error');
        if (keywords.length === 0) return showToast('Add at least one keyword', 'error');
        if (!ruleForm.reply_text.trim()) return showToast('Reply text is required', 'error');

        setSavingRule(true);
        try {
            await saveRule({ ...ruleForm, keywords });
            handleResetRule();
            showToast('Auto-reply rule saved', 'success');
        } catch (err) {
            showToast(`Failed to save rule: ${err.message}`, 'error');
        } finally {
            setSavingRule(false);
        }
    };

    const handleDeleteRule = async (rule) => {
        if (!window.confirm(`Delete auto-reply rule "${rule.name}"?`)) return;
        try {
            await deleteRule(rule.id);
            showToast('Rule deleted', 'info');
            if (ruleForm.id === rule.id) handleResetRule();
        } catch (err) {
            showToast(`Failed to delete rule: ${err.message}`, 'error');
        }
    };

    return (
        <div className="h-full flex flex-col gap-6 font-sans">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-500/20 rounded-xl text-blue-300 border border-blue-500/20">
                        <MessageCircle size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Messenger / Leads</h2>
                        <p className="text-sm text-slate-400">Capture Facebook inquiries and manage keyword replies.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-white/5 border border-white/10 rounded-xl p-1">
                        <button
                            onClick={() => setActiveView('inbox')}
                            className={clsx('px-4 py-2 rounded-lg text-sm font-bold transition-colors', activeView === 'inbox' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white')}
                        >
                            Inbox
                        </button>
                        <button
                            onClick={() => setActiveView('rules')}
                            className={clsx('px-4 py-2 rounded-lg text-sm font-bold transition-colors', activeView === 'rules' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white')}
                        >
                            Auto-Replies
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            fetchLeads();
                            fetchRules();
                        }}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white border border-white/10"
                        title="Refresh"
                    >
                        <RefreshCw size={18} className={loading || rulesLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                    {error}
                </div>
            )}

            {activeView === 'inbox' ? (
                <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_320px] gap-6 min-h-[640px]">
                    <section className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-white/5">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="Search leads..."
                                    className="glass-input pl-10 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                            {loading ? (
                                <div className="h-48 flex items-center justify-center text-slate-500">
                                    <Loader2 className="animate-spin mr-2" size={18} /> Loading leads
                                </div>
                            ) : filteredLeads.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-sm gap-3">
                                    <UserRound size={36} className="opacity-40" />
                                    No Messenger leads yet
                                </div>
                            ) : filteredLeads.map(lead => (
                                <button
                                    key={lead.id}
                                    onClick={() => setSelectedLeadId(lead.id)}
                                    className={clsx(
                                        'w-full p-4 text-left hover:bg-white/5 transition-colors',
                                        selectedLeadId === lead.id && 'bg-primary/10'
                                    )}
                                >
                                    <div className="flex items-start gap-3">
                                        {lead.profile_pic_url ? (
                                            <img src={lead.profile_pic_url} alt="" className="w-11 h-11 rounded-full object-cover bg-slate-800" />
                                        ) : (
                                            <div className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500">
                                                <UserRound size={20} />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="font-bold text-white truncate">{leadName(lead)}</h3>
                                                <span className="text-[10px] text-slate-500 whitespace-nowrap">{formatDate(lead.last_message_at)}</span>
                                            </div>
                                            <p className="text-xs text-slate-400 truncate mt-1">{lead.last_message_preview || 'No message preview'}</p>
                                            <span className="inline-flex mt-2 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-wide text-slate-300">
                                                {lead.status}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="glass-panel rounded-2xl flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-white/5 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">{selectedLead ? leadName(selectedLead) : 'Select a lead'}</h3>
                                <p className="text-xs text-slate-500 font-mono">{selectedLead?.psid || 'Messenger PSID appears here'}</p>
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-2">
                                <Clock size={14} /> {formatDate(selectedLead?.last_message_at)}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-black/10">
                            {messagesLoading ? (
                                <div className="h-48 flex items-center justify-center text-slate-500">
                                    <Loader2 className="animate-spin mr-2" size={18} /> Loading messages
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-sm gap-3">
                                    <MessageCircle size={36} className="opacity-40" />
                                    No saved messages for this lead
                                </div>
                            ) : messages.map(message => (
                                <div key={message.id} className={clsx('flex', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                                    <div className={clsx(
                                        'max-w-[78%] rounded-2xl px-4 py-3 border text-sm shadow-lg',
                                        message.direction === 'outgoing'
                                            ? 'bg-primary text-white border-primary/40 rounded-br-md'
                                            : 'bg-white/5 text-slate-200 border-white/10 rounded-bl-md'
                                    )}>
                                        <p className="whitespace-pre-wrap leading-relaxed">{message.text || '[Unsupported message]'}</p>
                                        <div className={clsx('text-[10px] mt-2 flex items-center gap-1', message.direction === 'outgoing' ? 'text-red-100/80' : 'text-slate-500')}>
                                            {message.direction === 'outgoing' && <Bot size={11} />}
                                            {formatDate(message.created_at)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <aside className="glass-panel rounded-2xl p-5 space-y-5">
                        <div>
                            <h3 className="text-lg font-bold text-white mb-1">Lead Details</h3>
                            <p className="text-xs text-slate-500">Edit qualification status and internal notes.</p>
                        </div>

                        {selectedLead ? (
                            <>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</label>
                                    <select
                                        value={leadForm.status}
                                        onChange={e => setLeadForm(prev => ({ ...prev, status: e.target.value }))}
                                        className="glass-input py-2"
                                    >
                                        {LEAD_STATUSES.map(status => (
                                            <option key={status} value={status} className="bg-slate-900">{status.replace('_', ' ')}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Notes</label>
                                    <textarea
                                        value={leadForm.notes}
                                        onChange={e => setLeadForm(prev => ({ ...prev, notes: e.target.value }))}
                                        rows={8}
                                        placeholder="Sizing preference, budget, delivery city, buying intent..."
                                        className="glass-input resize-none text-sm"
                                    />
                                </div>

                                <button
                                    onClick={handleSaveLead}
                                    disabled={savingLead}
                                    className="btn-primary w-full"
                                >
                                    {savingLead ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                    Save Lead
                                </button>

                                <div className="pt-4 border-t border-white/5 text-xs text-slate-500 space-y-2">
                                    <p><span className="text-slate-400">Source:</span> {selectedLead.source}</p>
                                    <p><span className="text-slate-400">Page:</span> {selectedLead.page_id}</p>
                                    <p><span className="text-slate-400">Created:</span> {formatDate(selectedLead.created_at)}</p>
                                </div>
                            </>
                        ) : (
                            <div className="py-16 text-center text-slate-500 text-sm">Select a lead to edit details.</div>
                        )}
                    </aside>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
                    <form onSubmit={handleSaveRule} className="glass-panel rounded-2xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">{ruleForm.id ? 'Edit Rule' : 'New Rule'}</h3>
                                <p className="text-xs text-slate-500">Match customer keywords and send a Messenger reply.</p>
                            </div>
                            {ruleForm.id && (
                                <button type="button" onClick={handleResetRule} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        <label className="block space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rule Name</span>
                            <input
                                value={ruleForm.name}
                                onChange={e => setRuleForm(prev => ({ ...prev, name: e.target.value }))}
                                className="glass-input"
                                placeholder="Product pricing"
                            />
                        </label>

                        <label className="block space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Keywords</span>
                            <input
                                value={ruleForm.keywordsText}
                                onChange={e => setRuleForm(prev => ({ ...prev, keywordsText: e.target.value }))}
                                className="glass-input"
                                placeholder="price, hm, how much"
                            />
                            <p className="text-[10px] text-slate-500">Separate keywords with commas.</p>
                        </label>

                        <label className="block space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Reply</span>
                            <textarea
                                value={ruleForm.reply_text}
                                onChange={e => setRuleForm(prev => ({ ...prev, reply_text: e.target.value }))}
                                className="glass-input resize-none"
                                rows={6}
                                placeholder="Hi! Shirt prices depend on design and quantity. What item are you interested in?"
                            />
                        </label>

                        <div className="grid grid-cols-2 gap-4">
                            <label className="block space-y-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Priority</span>
                                <input
                                    type="number"
                                    value={ruleForm.priority}
                                    onChange={e => setRuleForm(prev => ({ ...prev, priority: e.target.value }))}
                                    className="glass-input"
                                />
                            </label>
                            <label className="block space-y-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Match</span>
                                <select
                                    value={ruleForm.match_type}
                                    onChange={e => setRuleForm(prev => ({ ...prev, match_type: e.target.value }))}
                                    className="glass-input"
                                >
                                    <option value="contains" className="bg-slate-900">Contains</option>
                                    <option value="exact" className="bg-slate-900">Exact</option>
                                </select>
                            </label>
                        </div>

                        <label className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={ruleForm.is_active}
                                onChange={e => setRuleForm(prev => ({ ...prev, is_active: e.target.checked }))}
                                className="w-4 h-4 accent-primary"
                            />
                            <span className="text-sm text-slate-300">Rule is active</span>
                        </label>

                        <button type="submit" disabled={savingRule} className="btn-primary w-full">
                            {savingRule ? <Loader2 className="animate-spin" size={18} /> : ruleForm.id ? <Check size={18} /> : <Plus size={18} />}
                            {ruleForm.id ? 'Update Rule' : 'Create Rule'}
                        </button>
                    </form>

                    <section className="glass-panel rounded-2xl overflow-hidden">
                        <div className="p-5 border-b border-white/5 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">Auto-Reply Rules</h3>
                                <p className="text-xs text-slate-500">Lower priority numbers are matched first.</p>
                            </div>
                            {rulesLoading && <Loader2 className="animate-spin text-slate-500" size={18} />}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-black/20 text-slate-500 uppercase text-[10px] tracking-widest">
                                    <tr>
                                        <th className="p-4">Rule</th>
                                        <th className="p-4">Keywords</th>
                                        <th className="p-4">Reply</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {rules.length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="p-10 text-center text-slate-500">No rules yet.</td>
                                        </tr>
                                    ) : rules.map(rule => (
                                        <tr key={rule.id} className="hover:bg-white/5">
                                            <td className="p-4 align-top">
                                                <div className="font-bold text-white">{rule.name}</div>
                                                <div className="flex items-center gap-2 mt-2">
                                                    <span className={clsx('w-2 h-2 rounded-full', rule.is_active ? 'bg-emerald-400' : 'bg-slate-600')} />
                                                    <span className="text-[10px] text-slate-500 uppercase">{rule.is_active ? 'Active' : 'Paused'} · Priority {rule.priority}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 align-top max-w-xs">
                                                <div className="flex flex-wrap gap-1">
                                                    {(rule.keywords || []).map(keyword => (
                                                        <span key={keyword} className="px-2 py-1 rounded bg-blue-500/10 text-blue-200 border border-blue-500/20 text-[10px]">
                                                            {keyword}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="p-4 align-top text-slate-300 max-w-md">
                                                <p className="line-clamp-3">{rule.reply_text}</p>
                                            </td>
                                            <td className="p-4 align-top">
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => handleEditRule(rule)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button onClick={() => handleDeleteRule(rule)} className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-300">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
