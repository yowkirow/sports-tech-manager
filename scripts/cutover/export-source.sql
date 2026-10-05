SELECT jsonb_build_object(
    'format', 'sportstech-migration-baseline-v1',
    'exported_at', now(),
    'database_version', version(),
    'transactions', COALESCE((
        SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', t.amount::text, 'details', t.details::text) ORDER BY t.id)
        FROM public.transactions t
    ), '[]'::jsonb),
    'customers', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('total_spent', c.total_spent::text) ORDER BY c.id)
        FROM public.customers c
    ), '[]'::jsonb),
    'admin_directory', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.admin_directory a
    ), '[]'::jsonb),
    'referrers', COALESCE((
        SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('target_reimbursement', r.target_reimbursement::text) ORDER BY r.id)
        FROM public.referrers r
    ), '[]'::jsonb),
    'auth_identity_mapping', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', u.id, 'email', u.email, 'created_at', u.created_at,
            'preferences', jsonb_build_object(
                'full_name', u.raw_user_meta_data->'full_name',
                'expense_categories', u.raw_user_meta_data->'expense_categories',
                'enable_sms_notifications', u.raw_user_meta_data->'enable_sms_notifications',
                'enable_tracking_sms', u.raw_user_meta_data->'enable_tracking_sms',
                'tracking_sms_template', u.raw_user_meta_data->'tracking_sms_template',
                'textbee_device_id', u.raw_user_meta_data->'textbee_device_id'
            )::text,
            'has_sms_secret', u.raw_user_meta_data ? 'textbee_api_key'
        ) ORDER BY u.id) FROM auth.users u
    ), '[]'::jsonb),
    'storage_inventory', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', o.id, 'bucket_id', o.bucket_id, 'name', o.name, 'created_at', o.created_at,
            'updated_at', o.updated_at, 'metadata', o.metadata
        ) ORDER BY o.bucket_id, o.name) FROM storage.objects o
    ), '[]'::jsonb),
    'table_columns', (
        SELECT jsonb_agg(jsonb_build_object(
            'table', table_name, 'column', column_name, 'type', data_type,
            'nullable', is_nullable, 'default', column_default
        ) ORDER BY table_name, ordinal_position)
        FROM information_schema.columns WHERE table_schema = 'public'
    ),
    'constraints', (
        SELECT jsonb_agg(jsonb_build_object(
            'table', c.conrelid::regclass::text, 'name', c.conname, 'definition', pg_get_constraintdef(c.oid)
        ) ORDER BY c.conrelid::regclass::text, c.conname)
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
    ),
    'indexes', (
        SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname, 'definition', indexdef))
        FROM pg_indexes WHERE schemaname = 'public'
    ),
    'views', (
        SELECT jsonb_agg(jsonb_build_object('name', viewname, 'definition', definition))
        FROM pg_views WHERE schemaname = 'public'
    ),
    'policies', (
        SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname = 'public'
    ),
    'functions', (
        SELECT jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text, 'definition', pg_get_functiondef(p.oid)))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
    ),
    'transaction_count', (SELECT count(*) FROM public.transactions),
    'transaction_total', (SELECT sum(amount)::text FROM public.transactions),
    'scope', 'Business migration baseline only. Excludes passwords, PINs and SMS API secrets; does not contain storage object bytes or constitute a full restore backup.'
) AS export;
