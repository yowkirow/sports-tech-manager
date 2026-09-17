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
            // Parallel fetch: Logs + Identity Map
            const [logsRes, adminsRes] = await Promise.all([
                apiRequest('/api/activity?offset=0&limit=100'),
                userRole === 'owner' ? apiRequest('/api/members') : Promise.resolve({ members: [] })
            ]);

            if (!Array.isArray(logsRes.logs)) throw new Error('The activity log response could not be verified.');

            // Map emails to names
            const map = {};
            if (adminsRes.members) {
                adminsRes.members.forEach(a => {
                    if (a.email && a.name) map[a.email] = a.name;
                });
            }
            setAdminMap(map);

            let data = logsRes.logs;

            // Reseller Security: Only show own logs
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
            // prettify or summary
            return Object.entries(obj).map(([key, val]) => (
                <span key={key} className="block text-xs text-slate-400">
                    <span className="font-semibold text-slate-300 capitalize">{key}:</span> {typeof val === 'object' ? JSON.stringify(val) : val}
                </span>
            ));
        } catch (e) {
            return detailsStr;
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Activity className="text-primary" /> Audit Logs
                </h3>
                <button
                    onClick={fetchLogs}
                    disabled={loading}
                    className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && <p role="alert" className="text-sm text-red-300">{error} Use refresh to retry.</p>}
            <div className="glass-panel overflow-hidden p-0">
                <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-black/20 text-slate-400 uppercase text-xs sticky top-0 backdrop-blur-md">
                            <tr>
                                <th className="p-4 font-bold">Time</th>
                                <th className="p-4 font-bold">User</th>
                                <th className="p-4 font-bold">Action</th>
                                <th className="p-4 font-bold">Details</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-slate-500">
                                        {loading ? 'Loading logs...' : 'No activity recorded yet.'}
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="hover:bg-white/5 transition-colors">
                                        <td className="p-4 text-slate-400 whitespace-nowrap align-top">
                                            <div className="flex items-center gap-2">
                                                <Clock size={14} />
                                                {formatDate(log.created_at)}
                                            </div>
                                        </td>
                                        <td className="p-4 text-white align-top">
                                            <div className="flex items-center gap-2">
                                                <User size={14} className="text-slate-500" />
                                                {adminMap[log.user_email] ? (
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold text-white">{adminMap[log.user_email]}</span>
                                                        <span className="text-[10px] text-slate-500">{log.user_email}</span>
                                                    </div>
                                                ) : (
                                                    <span>{log.user_email}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 align-top">
                                            <span className="inline-block px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 font-medium border border-indigo-500/20">
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="p-4 align-top max-w-xs break-words">
                                            {formatDetails(log.details)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
