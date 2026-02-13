/**
 * Utility for interacting with LBC Express API
 * Documentation: https://lbcapiservice.lbcapps.com/
 */

export const trackShipment = async ({ trackingNumber, apiKey, accountNumber }) => {
    if (!trackingNumber || !apiKey) {
        throw new Error('Missing tracking number or API key');
    }

    // Typical LBC v2 Tracking Endpoint
    const endpoint = `https://lbcapiservice.lbcapps.com/api/v2/track/${trackingNumber}`;

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'x-account-number': accountNumber || '', // Some endpoints require this
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `LBC API Error: ${response.status}`);
        }

        const data = await response.json();

        // Return normalized tracking information
        return {
            status: data.status || 'Unknown',
            history: data.history || [],
            lastUpdate: data.last_update || new Date().toISOString(),
            raw: data
        };
    } catch (error) {
        console.error('LBC Tracking Error:', error);
        throw error;
    }
};
