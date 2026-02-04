import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export const useActivityLog = () => {
    const [logging, setLogging] = useState(false);

    const logActivity = useCallback(async (action, details = null, entityId = null, user = null) => {
        setLogging(true);
        try {
            // If user not passed, try to get from session (though ideally passed from component context)
            let userEmail = user?.email;

            if (!userEmail) {
                const { data: { session } } = await supabase.auth.getSession();
                userEmail = session?.user?.email;
            }

            if (!userEmail) {
                console.warn('Cannot log activity: No user identified');
                return;
            }

            // Get user name from admin_directory if possible for nicer display, 
            // but for the log table we assume user_email is sufficient or we do a join later.
            // For now, just logging email is the source of truth.

            const { error } = await supabase
                .from('activity_logs')
                .insert({
                    user_email: userEmail,
                    action,
                    details: typeof details === 'object' ? JSON.stringify(details) : details,
                    entity_id: entityId
                });

            if (error) throw error;

        } catch (err) {
            console.error('Failed to log activity:', err);
            // Don't block UI for logging failures
        } finally {
            setLogging(false);
        }
    }, []);

    return { logActivity, logging };
};
