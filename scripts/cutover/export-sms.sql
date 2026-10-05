SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_user_id', id,
    'settings', jsonb_build_object(
        'apiKey', raw_user_meta_data->>'textbee_api_key',
        'deviceId', raw_user_meta_data->>'textbee_device_id',
        'enableSmsNotifications', COALESCE((raw_user_meta_data->>'enable_sms_notifications')::boolean, false),
        'enableTrackingSms', COALESCE((raw_user_meta_data->>'enable_tracking_sms')::boolean, false),
        'trackingSmsTemplate', raw_user_meta_data->>'tracking_sms_template'
    )
)), '[]'::jsonb) AS profiles
FROM auth.users
WHERE COALESCE(raw_user_meta_data->>'textbee_api_key', '') <> '';
