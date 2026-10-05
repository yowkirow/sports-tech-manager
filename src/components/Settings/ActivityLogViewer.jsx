import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../lib/apiClient';
import { Loader2, RefreshCw, Clock, User, Activity } from 'lucide-react';

export default function ActivityLogViewer({ user, userRole }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [adminMap, setAdminMap] = useState({});
    const [error, setError] = useState(null);

    const fetchLogs = async () => {
        setLoading(true);
        setError(null);
        try {
            const [logsRes, adminsRes] = await Promise.all([
                apiRequest('/api/activity?offset=0&limit=100'),
                userRole === 'owner' ? apiRequest('/api/members') : Promise.resolve({ members: [] })
            ]);

            if (!Array.isArray(logsRes.logs)) throw new Error('The activity log response could not be verified.');

            const map = {};
            if (adminsRes.members) {
                adminsRes.members.forEach(a => {
                    if (a.email && a.name) map[a.email] = a.name;
                });
            }
            setAdminMap(map);

            let data = logsRes.logs;

            if (userRole === 'reseller' && user?.email) {
                data = data.filter(l => l.user_email === user.email);
            }

            setLogs(data);
        } catch (err) {
            console.error('Error fetching logs:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [user?.id, userRole]);

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const formatDetails = (detailsStr) => {
        if (!detailsStr) return '-';
        try {
            const obj = typeof detailsStr === 'object' ? detailsStr : JSON.parse(detailsStr);
            return Object.entries(obj).map(([key, val]) => (
                <span key={key} className="block text-xs text-ink-2">
                    <span className="font-semibold text-ink capitalize">{key}:</span> {typeof val === 'object' ? JSON.stringify(val) : val}
                </span>
            ));
        } catch (e) {
            return detailsStr;
        }
    };

    return (
        <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="audit-logs-title">
            <div className="flex items-center justify-between gap-3">
                <h3 id="audit-logs-title" className="section-title flex items-center gap-2">
                    <Activity className="text-ink-3" size={20} aria-hidden="true" /> Audit Logs
                </h3>
                <button
                    type="button"
                    onClick={fetchLogs}
                    disabled={loading}
                    className="icon-btn"
                    aria-label="Refresh audit logs"
                >
                    {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                </button>
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error} Use refresh to retry.</p>}
            <div className="overflow-hidden rounded-xl border border-line">
                <div className="max-h-[500px] overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-surface text-ink-2">
                            <tr className="border-b border-line">
                                <th className="px-3 py-3 font-medium">Time</th>
                                <th className="px-3 py-3 font-medium">User</th>
                                <th className="px-3 py-3 font-medium">Action</th>
                                <th className="px-3 py-3 font-medium">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-3 py-8 text-center text-ink-2">
                                        {loading ? 'Loading logs...' : 'No activity recorded yet.'}
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="border-b border-line transition-colors last:border-0 hover:bg-white/[0.04]">
                                        <td className="whitespace-nowrap px-3 py-3 align-top text-ink-2">
                                            <div className="flex items-center gap-2">
                                                <Clock size={14} aria-hidden="true" className="text-ink-3" />
                                                {formatDate(log.created_at)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 align-top text-ink">
                                            <div className="flex items-center gap-2">
                                                <User size={14} aria-hidden="true" className="text-ink-3" />
                                                {adminMap[log.user_email] ? (
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold text-ink">{adminMap[log.user_email]}</span>
                                                        <span className="text-xs text-ink-2">{log.user_email}</span>
                                                    </div>
                                                ) : (
                                                    <span>{log.user_email}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <span className="badge border-slate-600 text-ink">
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="max-w-xs break-words px-3 py-3 align-top text-ink-2">
                                            {formatDetails(log.details)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
