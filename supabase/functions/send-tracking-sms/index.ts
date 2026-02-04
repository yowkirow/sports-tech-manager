// Initialize Twilio
// You should set these secrets in your Supabase Dashboard:
// supabase secrets set TWILIO_ACCOUNT_SID=your_sid
// supabase secrets set TWILIO_AUTH_TOKEN=your_token
// supabase secrets set TWILIO_PHONE_NUMBER=your_twilio_number

// Setup CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { phoneNumber, customerName, trackingNumber, orderItems } = await req.json()

        if (!phoneNumber || !trackingNumber) {
            throw new Error("Missing phone number or tracking number")
        }

        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
        const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

        if (!accountSid || !authToken || !fromNumber) {
            throw new Error("Twilio secrets not configured")
        }

        // Construct Message
        const items = orderItems ? `Items: ${orderItems}` : '';
        const messageBody = `Hi ${customerName || 'there'}! Your SportsTech order is on the way. 
Tracking Number: ${trackingNumber}
${items}

Thank you for your purchase!
- SportsTech Team`

        // Call Twilio API
        const auth = btoa(`${accountSid}:${authToken}`)
        const resp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    'To': phoneNumber,
                    'From': fromNumber,
                    'Body': messageBody,
                }),
            }
        )

        const data = await resp.json()

        if (!resp.ok) {
            console.error("Twilio Command Error:", data)
            // Return 200 but with error field so frontend reads it easily
            return new Response(
                JSON.stringify({ success: false, error: `Twilio: ${data.message || resp.statusText}`, details: data }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, sid: data.sid }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error("Function Error:", error)
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            {
                status: 200, // Return 200 to ensure client receives the JSON body
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})
