import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { email, username, phone } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "ایمیل الزامی است" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone?.trim() || "";
    const normalizedUsername = username?.trim() || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check for existing confirmed phone
    const { data: phoneTaken } = await supabase.rpc("check_phone_exists", { p_phone: normalizedPhone });
    if (phoneTaken) {
      return new Response(JSON.stringify({ error: "این شماره تلفن قبلاً ثبت شده است" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for existing confirmed email
    const { data: emailTaken } = await supabase.rpc("check_email_exists", { p_email: normalizedEmail });
    if (emailTaken) {
      return new Response(JSON.stringify({ error: "این ایمیل قبلاً ثبت شده است" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean up any unconfirmed user from a previous attempt (by email OR phone)
    await supabase.rpc("delete_unconfirmed_user", { p_email: normalizedEmail, p_phone: normalizedPhone });

    // generateLink with type "signup" creates the user and returns the OTP token.
    // It does NOT send an email when called via admin API — no rate limit.
    // A temporary password is required; the real password is set after OTP verification.
    const tempPassword = crypto.randomUUID() + crypto.randomUUID();

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      password: tempPassword,
      options: {
        data: { username: normalizedUsername, phone: normalizedPhone },
      },
    });

    if (linkError) {
      return new Response(JSON.stringify({ error: linkError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract the 6-digit OTP code from the response
    const props = linkData.properties || {};
    const otpCode = props.email_otp || props.otp || "";

    // Try to send the code via Brevo email
    let emailSent = false;
    let emailError: string | undefined;

    const brevoKey = Deno.env.get("BREVO_API_KEY") || Deno.env.get("RESEND_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "noreply@sirachat.com";
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "SiraChat";
    if (brevoKey && otpCode) {
      try {
        const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": brevoKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: normalizedEmail }],
            subject: "کد تایید ثبت‌نام - سیرا چت",
            htmlContent: `
              <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h2 style="text-align: center; color: #2196F3;">سیرا چت</h2>
                <p style="text-align: center; font-size: 16px; color: #333;">کد تایید شما:</p>
                <div style="text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2196F3; padding: 20px 0;">${otpCode}</div>
                <p style="text-align: center; font-size: 14px; color: #999;">این کد ۱۰ دقیقه اعتبار دارد.</p>
              </div>
            `,
          }),
        });
        if (resp.ok) {
          emailSent = true;
        } else {
          const errBody = await resp.text();
          emailError = JSON.stringify({ http_status: resp.status, body: errBody, sender: senderEmail });
        }
      } catch (e) {
        emailError = String(e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
