import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export const LEAD_STATUSES = ['new', 'active', 'qualified', 'order_created', 'closed', 'spam'];

export function useMessengerLeads() {
    const [leads, setLeads] = useState([]);
    const [messages, setMessages] = useState([]);
    const [rules, setRules] = useState([]);
    const [selectedLeadId, setSelectedLeadId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [error, setError] = useState(null);

    const selectedLead = useMemo(
        () => leads.find(lead => lead.id === selectedLeadId) || leads[0] || null,
        [leads, selectedLeadId]
    );

    const fetchLeads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase
                .from('messenger_leads')
                .select('*')
                .order('last_message_at', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLeads(data || []);
            setSelectedLeadId(current => current || data?.[0]?.id || null);
        } catch (err) {
            console.error('Failed to fetch Messenger leads:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchMessages = useCallback(async (leadId) => {
        if (!leadId) {
            setMessages([]);
            return;
        }

        setMessagesLoading(true);
        try {
            const { data, error } = await supabase
                .from('messenger_messages')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setMessages(data || []);
        } catch (err) {
            console.error('Failed to fetch Messenger messages:', err);
            setError(err.message);
        } finally {
            setMessagesLoading(false);
        }
    }, []);

    const fetchRules = useCallback(async () => {
        setRulesLoading(true);
        try {
            const { data, error } = await supabase
                .from('auto_reply_rules')
                .select('*')
                .order('priority', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;
            setRules(data || []);
        } catch (err) {
            console.error('Failed to fetch auto-reply rules:', err);
            setError(err.message);
        } finally {
            setRulesLoading(false);
        }
    }, []);

    const updateLead = useCallback(async (leadId, updates) => {
        const { data, error } = await supabase
            .from('messenger_leads')
            .update(updates)
            .eq('id', leadId)
            .select()
            .single();

        if (error) throw error;
        setLeads(prev => prev.map(lead => lead.id === leadId ? data : lead));
        return data;
    }, []);

    const saveRule = useCallback(async (rule) => {
        const payload = {
            name: rule.name.trim(),
            keywords: rule.keywords,
            reply_text: rule.reply_text.trim(),
            priority: Number(rule.priority) || 100,
            is_active: Boolean(rule.is_active),
            match_type: rule.match_type || 'contains'
        };

        const query = rule.id
            ? supabase.from('auto_reply_rules').update(payload).eq('id', rule.id)
            : supabase.from('auto_reply_rules').insert(payload);

        const { data, error } = await query.select().single();
        if (error) throw error;

        setRules(prev => {
            const exists = prev.some(item => item.id === data.id);
            const next = exists ? prev.map(item => item.id === data.id ? data : item) : [...prev, data];
            return next.sort((a, b) => (a.priority || 100) - (b.priority || 100));
        });
        return data;
    }, []);

    const deleteRule = useCallback(async (ruleId) => {
        const { error } = await supabase
            .from('auto_reply_rules')
            .delete()
            .eq('id', ruleId);

        if (error) throw error;
        setRules(prev => prev.filter(rule => rule.id !== ruleId));
    }, []);

    useEffect(() => {
        fetchLeads();
        fetchRules();
    }, [fetchLeads, fetchRules]);

    useEffect(() => {
        fetchMessages(selectedLead?.id);
    }, [fetchMessages, selectedLead?.id]);

    return {
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
        fetchMessages,
        fetchRules,
        updateLead,
        saveRule,
        deleteRule
    };
}
