import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "124225853613-okfnb5gconblb1bhtr4tnloj3n4d77m8.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "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";
const TEAM_REPLY_TO = "1dcestimatesdonotreply@gmail.com";

// ── OAuth client with auto-refresh ──────────────────────────────────────────
function getOAuthClient(accessToken: string, refreshToken: string | null): OAuth2Client {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
  });
  return client;
}

async function gmailFetch(client: OAuth2Client, path: string, opts: RequestInit = {}): Promise<any> {
  const token = await client.getAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${token.token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Encode email as RFC 2822 base64url ──────────────────────────────────────
function buildRawEmail(opts: {
  from: string; to: string; subject: string; html: string; replyTo?: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Reply-To: ${opts.replyTo || TEAM_REPLY_TO}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    opts.html,
  ].join("\r\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Send via Gmail API ──────────────────────────────────────────────────────
export async function sendGmailEmail(opts: {
  senderName: string;
  senderEmail: string;
  accessToken: string;
  refreshToken: string | null;
  to: string;
  subject: string;
  html: string;
  threadId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const client = getOAuthClient(opts.accessToken, opts.refreshToken);
  const raw = buildRawEmail({
    from: `${opts.senderName} | 1 Degree Construction <${opts.senderEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });

  const result = await gmailFetch(client, "/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId: opts.threadId }),
  });

  return { messageId: result.id || "", threadId: result.threadId || "" };
}

// ── Poll team inbox for inbound replies ─────────────────────────────────────
export async function pollTeamInbox(opts: {
  accessToken: string;
  refreshToken: string | null;
}): Promise<Array<{
  messageId: string; threadId: string; fromEmail: string; fromName: string;
  subject: string; bodyText: string; bodyHtml: string; date: Date;
}>> {
  const client = getOAuthClient(opts.accessToken, opts.refreshToken);

  const listRes = await gmailFetch(client,
    "/users/me/messages?q=" + encodeURIComponent("is:unread -from:me newer_than:7d") + "&maxResults=50"
  );

  const messages: Array<{ id: string }> = listRes.messages || [];
  const results = [];

  for (const msg of messages) {
    try {
      const full = await gmailFetch(client, `/users/me/messages/${msg.id}?format=full`);
      const headers: Array<{ name: string; value: string }> = full.payload?.headers || [];
      const get = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      const fromRaw = get("From");
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
      const fromName = fromMatch ? fromMatch[1].trim().replace(/^"|"$/g, "") : fromRaw;
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

      let bodyText = "";
      let bodyHtml = "";
      const decodeBase64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

      const extractBody = (parts: any[]): void => {
        for (const part of parts) {
          if (!part) continue;
          if (part.mimeType === "text/plain" && part.body?.data) bodyText = decodeBase64(part.body.data);
          if (part.mimeType === "text/html" && part.body?.data) bodyHtml = decodeBase64(part.body.data);
          if (part.parts) extractBody(part.parts);
        }
      };
      extractBody(full.payload?.parts || [full.payload]);
      if (!bodyHtml && full.payload?.body?.data) bodyHtml = decodeBase64(full.payload.body.data);
      if (!bodyText && full.payload?.body?.data) bodyText = decodeBase64(full.payload.body.data);

      results.push({
        messageId: msg.id,
        threadId: full.threadId || "",
        fromEmail, fromName,
        subject: get("Subject"),
        bodyText, bodyHtml,
        date: new Date(parseInt(full.internalDate || "0")),
      });
    } catch {
      // skip malformed messages
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Email Templates
// ─────────────────────────────────────────────────────────────────────────────

function wrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#0a0a0a;padding:28px 36px;">
      <div style="color:#e87722;font-size:22px;font-weight:700;letter-spacing:-0.5px;">1 Degree Construction</div>
    </div>
    <div style="padding:36px;">${content}</div>
    <div style="background:#f9f9f9;border-top:1px solid #eeeeee;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#888;">
        1 Degree Construction &nbsp;·&nbsp; 13107 Ventura Blvd #206, Studio City CA 91604<br>
        License #1075129 &nbsp;·&nbsp; <a href="https://www.1degreeconstruction.com" style="color:#e87722;text-decoration:none;">www.1degreeconstruction.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function buildEstimateEmail(opts: {
  clientName: string; senderName: string; estimateNumber: string;
  projectAddress: string; totalClientPrice: number; viewUrl: string; validUntil: string;
}): { subject: string; html: string } {
  const subject = `Your Estimate from 1 Degree Construction — ${opts.estimateNumber}`;
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(opts.totalClientPrice);
  const validDate = opts.validUntil ? new Date(opts.validUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  const html = wrapper(`
    <p style="margin:0 0 8px;font-size:15px;color:#333;">Hi ${opts.clientName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      Thank you for choosing 1 Degree Construction. Please find your estimate for the project at
      <strong>${opts.projectAddress}</strong> attached below.
    </p>
    <div style="border:1px solid #e5e5e5;border-radius:8px;padding:24px;margin-bottom:28px;background:#fafafa;">
      <div style="font-size:13px;color:#999;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Estimate</div>
      <div style="font-size:20px;font-weight:700;color:#0a0a0a;margin-bottom:16px;">${opts.estimateNumber}</div>
      <div><div style="font-size:12px;color:#999;margin-bottom:2px;">Total</div><div style="font-size:22px;font-weight:700;color:#e87722;">${formatted}</div></div>
      ${validDate ? `<div style="margin-top:12px;"><div style="font-size:12px;color:#999;margin-bottom:2px;">Valid Until</div><div style="font-size:15px;font-weight:600;color:#333;">${validDate}</div></div>` : ""}
    </div>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${opts.viewUrl}" style="display:inline-block;background:#e87722;color:#fff;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">Review &amp; Sign Estimate</a>
    </div>
    <p style="margin:0 0 4px;font-size:14px;color:#666;line-height:1.6;">The link above will take you to a secure page where you can review all project details and sign electronically.</p>
    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Questions? Reply to this email or call us directly.</p>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:14px;color:#333;">Best regards,<br><strong>${opts.senderName}</strong><br>1 Degree Construction</p>
    </div>
  `);
  return { subject, html };
}

export function buildFollowUpEmail(opts: {
  clientName: string; senderName: string; estimateNumber: string;
  projectAddress: string; viewUrl: string; daysSinceSent: number;
}): { subject: string; html: string } {
  const subject = `Following Up — Estimate ${opts.estimateNumber} | 1 Degree Construction`;
  const html = wrapper(`
    <p style="margin:0 0 8px;font-size:15px;color:#333;">Hi ${opts.clientName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      I wanted to follow up on the estimate I sent ${opts.daysSinceSent} day${opts.daysSinceSent !== 1 ? "s" : ""} ago for your project at <strong>${opts.projectAddress}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">If you have any questions, I'm happy to walk you through it.</p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${opts.viewUrl}" style="display:inline-block;background:#e87722;color:#fff;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">Review Estimate</a>
    </div>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:14px;color:#333;">Best regards,<br><strong>${opts.senderName}</strong><br>1 Degree Construction</p>
    </div>
  `);
  return { subject, html };
}

export function buildClientViewedEmail(opts: {
  clientName: string; estimateNumber: string; projectAddress: string; viewUrl: string; viewedAt: string;
}): { subject: string; html: string } {
  const subject = `[1DC] ${opts.clientName} viewed estimate ${opts.estimateNumber}`;
  const html = wrapper(`
    <p style="margin:0 0 16px;font-size:15px;color:#333;"><strong>${opts.clientName}</strong> just opened estimate <strong>${opts.estimateNumber}</strong>.</p>
    <div style="border-left:3px solid #e87722;padding-left:16px;margin-bottom:24px;">
      <div style="font-size:14px;color:#555;margin-bottom:4px;">Project: ${opts.projectAddress}</div>
      <div style="font-size:14px;color:#555;">Viewed: ${new Date(opts.viewedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>
    <a href="${opts.viewUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">Open Estimate →</a>
  `);
  return { subject, html };
}

export function buildClientSignedEmail(opts: {
  clientName: string; estimateNumber: string; projectAddress: string;
  totalClientPrice: number; signedAt: string; viewUrl: string;
}): { subject: string; html: string } {
  const subject = `🎉 [1DC] ${opts.clientName} signed estimate ${opts.estimateNumber}`;
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(opts.totalClientPrice);
  const html = wrapper(`
    <p style="margin:0 0 16px;font-size:15px;color:#333;"><strong>${opts.clientName}</strong> signed and accepted estimate <strong>${opts.estimateNumber}</strong>.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="font-size:14px;color:#166534;margin-bottom:4px;">Project: ${opts.projectAddress}</div>
      <div style="font-size:22px;font-weight:700;color:#166534;margin-bottom:4px;">${formatted}</div>
      <div style="font-size:13px;color:#166534;">Signed: ${new Date(opts.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>
    <a href="${opts.viewUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">View Signed Estimate →</a>
  `);
  return { subject, html };
}
