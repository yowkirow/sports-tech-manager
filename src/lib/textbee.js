/**
 * Utility for sending SMS via textbee.dev
 */
export const sendSMS = async ({ apiKey, deviceId, recipient, message }) => {
    if (!apiKey || !deviceId || !recipient || !message) {
        throw new Error('Missing required SMS parameters');
    }

    // Helper to format PH numbers to International format
    const formatPhoneNumber = (num) => {
        const clean = num.toString().replace(/[\s\-\(\)]/g, '');
        if (clean.startsWith('9')) return `+63${clean}`;
        if (clean.startsWith('09')) return `+63${clean.slice(1)}`;
        if (clean.startsWith('639')) return `+${clean}`;
        if (clean.startsWith('+639')) return clean;
        return clean; // Return original if it doesn't match PH patterns
    };

    const cleanApiKey = apiKey.trim();
    const cleanDeviceId = deviceId.trim();
    const formattedRecipient = formatPhoneNumber(recipient);

    const endpoint = `https://api.textbee.dev/api/v1/gateway/devices/${cleanDeviceId}/send-sms`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': cleanApiKey,
            },
            body: JSON.stringify({
                recipients: [formattedRecipient],
                message: message,
            }),
        });

        if (!response.ok) {
            const textBody = await response.text();
            let errorMsg = `SMS Gateway Error: ${response.status}`;
            try {
                const jsonError = JSON.parse(textBody);
                errorMsg = jsonError.message || jsonError.error || errorMsg;
            } catch (e) {
                // If not JSON, use the text body
                if (textBody) errorMsg = `SMS Gateway Error: ${response.status} - ${textBody}`;
            }
            throw new Error(errorMsg);
        }

        return await response.json();
    } catch (error) {
        console.error('TextBee API Error:', error);
        throw error;
    }
};
