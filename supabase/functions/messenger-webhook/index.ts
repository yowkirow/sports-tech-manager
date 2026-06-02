import { createClient } from "npm:@supabase/supabase-js@2";

type AutoReplyRule = {
  id: string;
  name: string;
  keywords: string[];
  reply_text: string;
  match_type: "contains" | "exact";
};

const jsonHeaders = { "Content-Type": "application/json" };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const verifyToken = Deno.env.get("MESSENGER_VERIFY_TOKEN") ?? "";
const pageAccessToken = Deno.env.get("MESSENGER_PAGE_ACCESS_TOKEN") ?? "";
const appSecret = Deno.env.get("MESSENGER_APP_SECRET") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifySignature(rawBody: string, signatureHeader: string | null) {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return timingSafeEqual(`sha256=${toHex(digest)}`, signatureHeader);
}

function normalizeText(value: string) {
  return value.toLowerCase().trim();
}

function findRule(messageText: string, rules: AutoReplyRule[]) {
  const normalized = normalizeText(messageText);
  return rules.find((rule) => {
    const keywords = (rule.keywords || []).map(normalizeText).filter(Boolean);
    if (rule.match_type === "exact") {
      return keywords.some((keyword) => normalized === keyword);
    }
    return keywords.some((keyword) => normalized.includes(keyword));
  });
}

async function fetchMessengerProfile(psid: string) {
  if (!pageAccessToken) return {};
  const url = new URL(`https://graph.facebook.com/v20.0/${psid}`);
  url.searchParams.set("fields", "first_name,last_name,profile_pic");
  url.searchParams.set("access_token", pageAccessToken);

  try {
    const response = await fetch(url);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

async function sendMessengerText(psid: string, text: string) {
  if (!pageAccessToken) {
    throw new Error("MESSENGER_PAGE_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/me/messages?access_token=${pageAccessToken}`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      }),
    },
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || "Failed to send Messenger reply");
  }
  return body;
}

async function upsertLead(pageId: string, psid: string, messageText: string, payload: unknown) {
  const profile = await fetchMessengerProfile(psid);
  const firstName = typeof profile.first_name === "string" ? profile.first_name : null;
  const lastName = typeof profile.last_name === "string" ? profile.last_name : null;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  const { data, error } = await supabase
    .from("messenger_leads")
    .upsert(
      {
        page_id: pageId,
        psid,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        profile_pic_url: typeof profile.profile_pic === "string" ? profile.profile_pic : null,
        last_message_at: new Date().toISOString(),
        last_message_preview: messageText.slice(0, 240),
        metadata: { lastWebhookPayload: payload },
      },
      { onConflict: "page_id,psid" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const rawBody = await req.text();
  const signatureOk = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!signatureOk) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const payload = JSON.parse(rawBody);
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const pageId = String(entry.id ?? "");
    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const event of messagingEvents) {
      const psid = String(event.sender?.id ?? "");
      const message = event.message;
      const messageText = typeof message?.text === "string" ? message.text.trim() : "";

      if (!pageId || !psid || !messageText || message?.is_echo) continue;

      const lead = await upsertLead(pageId, psid, messageText, event);

      await supabase.from("messenger_messages").upsert(
        {
          lead_id: lead.id,
          page_id: pageId,
          psid,
          message_id: message.mid || crypto.randomUUID(),
          direction: "incoming",
          message_type: "text",
          text: messageText,
          payload: event,
          delivery_status: "received",
        },
        { onConflict: "message_id,direction" },
      );

      const { data: rules, error: rulesError } = await supabase
        .from("auto_reply_rules")
        .select("id,name,keywords,reply_text,match_type")
        .eq("is_active", true)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (rulesError) throw rulesError;

      const matchedRule = findRule(messageText, (rules || []) as AutoReplyRule[]);
      if (!matchedRule) continue;

      const sent = await sendMessengerText(psid, matchedRule.reply_text);
      await supabase.from("messenger_messages").insert({
        lead_id: lead.id,
        page_id: pageId,
        psid,
        message_id: sent?.message_id || crypto.randomUUID(),
        direction: "outgoing",
        message_type: "text",
        text: matchedRule.reply_text,
        payload: sent,
        auto_reply_rule_id: matchedRule.id,
        delivery_status: "sent",
      });

      await supabase
        .from("messenger_leads")
        .update({
          status: lead.status === "new" ? "active" : lead.status,
          last_message_at: new Date().toISOString(),
          last_message_preview: matchedRule.reply_text.slice(0, 240),
        })
        .eq("id", lead.id);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
