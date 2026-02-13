/**
 * Utility for sending SMS via textbee.dev
 */
export const sendSMS = async ({ apiKey, deviceId, recipient, message }) => {
    if (!apiKey || !deviceId || !recipient || !message) {
        throw new Error('Missing required SMS parameters');
    }

    const endpoint = `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify({
                recipients: [recipient],
                body: message,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `SMS Gateway Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('TextBee API Error:', error);
        throw error;
    }
};
