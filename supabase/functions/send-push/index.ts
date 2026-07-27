import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { webpush } from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function getVapidKeys() {
  const { data, error } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["vapid_public_key", "vapid_private_key"]);
  if (error || !data || data.length < 2) throw new Error("VAPID keys not configured");
  const map = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
  return { publicKey: map.vapid_public_key, privateKey: map.vapid_private_key };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { chat_id, message_id, sender_id, content, message_type } = await req.json();

    if (!chat_id || !sender_id) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all chat members except the sender
    const { data: members, error: membersError } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chat_id)
      .neq("user_id", sender_id);

    if (membersError || !members || members.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientIds = members.map((m: any) => m.user_id);

    // Get sender profile for notification body
    const { data: sender } = await supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", sender_id)
      .maybeSingle();

    // Get chat title
    const { data: chat } = await supabase
      .from("chats")
      .select("title, type")
      .eq("id", chat_id)
      .maybeSingle();

    const senderName = sender?.display_name || sender?.username || "کاربر";
    const chatTitle = chat?.type === "direct" ? senderName : (chat?.title || "سیرا چت");

    let body = "";
    if (message_type === "text") body = content || "";
    else if (message_type === "image") body = "🖼 تصویر";
    else if (message_type === "file") body = "📎 فایل";
    else if (message_type === "voice") body = "🎤 پیام صوتی";
    else if (message_type === "call") body = "📞 تماس";
    else body = "پیام جدید";

    // Get all push subscriptions for recipients
    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id")
      .in("user_id", recipientIds);

    if (subsError || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapid = await getVapidKeys();
    webpush.setVapidDetails(
      `mailto:noreply@sirachat.app`,
      vapid.publicKey,
      vapid.privateKey
    );

    const payload = JSON.stringify({
      title: chatTitle,
      body: `${senderName}: ${body}`,
      chat_id,
      message_id,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });

    let sent = 0;
    const failedEndpoints: string[] = [];

    await Promise.all(
      subs.map(async (sub: any) => {
        try {
          const pushSub = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          };
          await webpush.sendNotification(pushSub, payload, {
            TTL: 86400,
          });
          sent++;
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            failedEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    // Clean up expired subscriptions
    if (failedEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", failedEndpoints);
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
