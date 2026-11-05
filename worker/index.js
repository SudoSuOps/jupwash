/**
 * Jupiter Power Wash - Website API (Cloudflare Worker)
 *
 *   POST /api/contact  -> emails the lead to NOTIFY_EMAIL and LEAD_ALERT_EMAIL via Resend
 *   POST /api/chat     -> "Splash" chat assistant on Workers AI
 *
 * Stateless: no database. Secrets: RESEND_API_KEY (wrangler secret put RESEND_API_KEY).
 *
 * Rule for /api/contact: never tell a customer "sent" unless Resend accepted
 * the email. A failed send returns an error so the page tells them to call.
 */

const PHONE_DISPLAY = '561-532-7120';

const SERVICE_AREA = 'Jupiter, Tequesta, Palm Beach Gardens and Juno Beach';

const SYSTEM_PROMPT = `You are Splash, the friendly assistant on the Jupiter Power Wash website. Jupiter Power Wash is a local, family-owned power washing company in Jupiter, Florida.

FACTS (only state facts from this list):
- Services: home exteriors on SINGLE-STORY homes only (stucco walls, hurricane shutters, windows and doors) - we do NOT wash two-story houses; say so plainly and kindly, without giving a reason, concrete and brick-paver driveways, patios, pool areas / pool decks, sidewalks, and solar panel cleaning (specialty, see below). All of these are priced with the same half-day / full-day pricing.
- Service area: ${SERVICE_AREA}. If someone is outside this, tell them to call and ask - don't promise.
- Phone (call or text): ${PHONE_DISPLAY}. This is the fastest way to get a free estimate.
- Email: clean@jupiterpowerwash.com
- Payment is collected on the day of the job (cash, check or card). No online prepayment.
- Equipment: our pressure washers are electric - much quieter than gas machines, no exhaust fumes at the customer's home. We need an outdoor electrical outlet; if there isn't one, we bring our own generator - no problem. Don't quote any generator fee. Don't call it "zero emissions" or make other environmental claims beyond quiet / no exhaust at the home.
- Cleaners (why: Florida humidity regrows mildew/algae fast, salt air leaves a film that holds moisture and eats metal, heat dries soap fast, runoff goes to the Loxahatchee/Intracoastal): Simple Green Oxy Solve House & Siding (EPA Safer Choice certified, biodegradable) for stucco, shutters, windows and doors; Simple Green Oxy Solve Concrete & Driveway for driveways, pavers, pool decks; a thorough fresh-water rinse to remove coastal salt film. We use Simple Green on every job - don't name other cleaning brands. We soak plants before and rinse after. Really stubborn black mildew sometimes needs a stronger diluted soft-wash treatment - we tell the customer first. Never call our cleaning 'organic' or 'chemical-free'. Don't say what is used on solar panels beyond the hand process.
- Referral offer: code JUPFRIEND50 - the customer and the friend they refer each save $50.
- Coaster offer: $50 off the wash when the customer has a Jup Wash coaster. The only codes are COAST-H, COAST-R, and COAST-H2. They claim it on https://jupiterpowerwash.com/coaster — the link on the coaster already includes their code. Don't add expiration, minimums, stacking, or any other terms. If they have no code, tell them to open the link on the coaster or call ${PHONE_DISPLAY}.
- Services are done in half-day or full-day visits (see pricing).

PRICING (this is the whole price list - never quote any other numbers):
- Half day, full service: $300
- Full day, full service: $550
- How it works: the customer sends a photo of what they want cleaned (text it to ${PHONE_DISPLAY}, or attach it to the "Send a Message" form on this page). We look at it and tell them up front whether it's a half day or a full day. Estimates are free.
- Our promise: full service made easy. No per-square-foot pricing, no surprise add-ons.
- You can't tell from a description alone whether a job is a half or full day - ask them to send a photo.

SOLAR PANEL CLEANING (specialty service, separate from the half/full day pricing):
- $995 flat, one-time clean: a full day with a two-person crew. White-glove service, full top coverage (every panel on the roof).
- How we clean panels (all by hand): 1) pre-soak, 2) hand wash, 3) hand wipe and clean, 4) after-clean treatment. Don't describe what's in the treatment or make claims about it beyond this.
- Single-story homes only, metal or shingle roofs. We do NOT do two-story homes - say so plainly and kindly. Never suggest other companies.
- Done on Saturdays only because it's a specialty job. We are CLOSED on Sundays - never offer Sunday.
- Business hours: Monday-Saturday 8am-6pm. Closed Sunday.
- Yearly service plan: $1,795/year for 2 panel cleanings (about every 6 months) - saves $195 vs two one-time cleans.
- Why clean every 6-12 months: dust, pollen, salt spray and bird droppings form a film that blocks sunlight, rain doesn't wash it off, and Florida's salt air and pollen build it up fast. Clean panels produce closer to their rated output. Don't quote specific efficiency percentages.
- To book: text a photo of the roof/panels to ${PHONE_DISPLAY} or call.

RULES:
1. There is no online booking. To schedule or get a quote, the customer calls or texts ${PHONE_DISPLAY}, or uses the "Send a Message" form on this page. When they text, ask them to include a photo AND their street address and town - we schedule jobs by street. Don't collect their details yourself in this chat.
2. If asked about a service not listed above (roof cleaning, gutters, etc.), say you're not sure it's offered and ask them to call ${PHONE_DISPLAY} to ask. Never recommend or name other companies.
3. For two-story homes (house washing or solar), just say we only do single-story homes. Do NOT give any reason - never mention equipment, ladders, safety or insurance.
4. Don't invent facts: no made-up hours, guarantees, licenses, discounts or availability. If you don't know, say so and give the phone number.
5. Keep answers short (2-4 sentences), warm and casual. Plain text only, no markdown.`;

const ALLOWED_ORIGINS = new Set([
  'https://jupiterpowerwash.com',
  'https://www.jupiterpowerwash.com',
  'https://jupwash.pages.dev',
]);

const TOWNS = ['Jupiter', 'Tequesta', 'Palm Beach Gardens', 'Juno Beach'];

const COASTER_CODES = new Set(['COAST-H', 'COAST-R', 'COAST-H2']);

const LIMITS = { street: 150, name: 100, email: 200, phone: 40, message: 4000, chat: 1000, historyItem: 2000 };

// Photos arrive already shrunk by the browser (~1600px JPEG). Base64 sizes.
const MAX_PHOTOS = 5;
const MAX_PHOTO_B64 = 6 * 1024 * 1024;
const MAX_TOTAL_B64 = 20 * 1024 * 1024;

function cleanPhotos(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let total = 0;
  for (const p of raw.slice(0, MAX_PHOTOS)) {
    if (!p || typeof p.content !== 'string' || !p.content) continue;
    if (p.content.length > MAX_PHOTO_B64 || !/^[A-Za-z0-9+/=]+$/.test(p.content)) continue;
    if (total + p.content.length > MAX_TOTAL_B64) break;
    total += p.content.length;
    const base = clean(p.filename, 80).replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_') || 'photo';
    out.push({ filename: `${out.length + 1}-${base}.jpg`, content: p.content, content_type: 'image/jpeg' });
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/contact') {
      return handleContact(request, env, cors, ctx);
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      return handleChat(request, env, cors);
    }

    return new Response('Jupiter Power Wash API', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', ...cors },
    });
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.jupwash\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://jupiterpowerwash.com',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function verifyTurnstile(env, token, remoteip) {
  const expectedHostnames = new Set(
    String(env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean),
  );
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || token.length === 0 || token.length > 2048 || expectedHostnames.size === 0) {
    return false;
  }
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (remoteip) body.set('remoteip', remoteip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return false;
    const result = await r.json();
    const ok = result.success === true && result.action === 'contact' && expectedHostnames.has(result.hostname);
    if (!ok) console.log('turnstile rejected', JSON.stringify({ codes: result['error-codes'], action: result.action, hostname: result.hostname }));
    return ok;
  } catch (err) {
    console.log('turnstile error', String(err));
    return false;
  }
}

async function handleContact(request, env, cors, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request' }, 400, cors);
  }

  // Honeypot: real people never fill the hidden "website" field. Pretend success for bots.
  if (clean(data.website, 200)) {
    return jsonResponse({ success: true, messageId: 'OK' }, 200, cors);
  }

  const name = clean(data.name, LIMITS.name);
  const email = clean(data.email, LIMITS.email);
  const phone = clean(data.phone, LIMITS.phone);
  const message = clean(data.message, LIMITS.message);
  const street = clean(data.street, LIMITS.street);
  const townRaw = clean(data.town, 40);
  const town = TOWNS.includes(townRaw) ? townRaw : (townRaw ? 'Other' : '');
  const outlet = { yes: 'Yes', no: 'No - bring the generator' }[clean(data.outlet, 10)] || 'Not sure';
  const smsConsent = clean(data.sms_consent, 8) === 'yes' ? 'Yes' : 'No';
  const codeCandidate = clean(data.code, 16).toUpperCase();
  const coasterCode = COASTER_CODES.has(codeCandidate) ? codeCandidate : '';
  const fromCoaster = clean(data.source, 20) === 'coaster' || Boolean(coasterCode);
  const leadSource = coasterCode
    ? `coaster ${coasterCode}`
    : (fromCoaster ? 'coaster (no recognized code)' : 'website contact form');

  if (!name || !message || (!email && !phone)) {
    return jsonResponse({ error: 'Please add your name, a message, and an email or phone number.' }, 400, cors);
  }
  if (!street || !town) {
    return jsonResponse({ error: 'Please add the street address and town where the job is.' }, 400, cors);
  }
  // Bot check (Cloudflare Turnstile). Fail closed: no valid token, no email.
  if (!(await verifyTurnstile(env, data['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return jsonResponse({ error: 'Security check failed' }, 403, cors);
  }

  const address = `${street}, ${town === 'Other' ? '(outside service area)' : `${town}, FL`}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${street}, ${town === 'Other' ? '' : town + ', '}FL`)}`;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'That email address doesn\'t look right.' }, 400, cors);
  }

  const photos = cleanPhotos(data.photos);
  const refId = Date.now().toString(36).toUpperCase();
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const text = [
    'NEW WEBSITE LEAD - Jupiter Power Wash',
    `Ref: ${refId}`,
    `Received: ${when} ET`,
    `Source: ${leadSource}`,
    '',
    `Address: ${address}`,
    `Map:     ${mapsUrl}`,
    ...(town === 'Other' ? ['** OUTSIDE SERVICE AREA (Jupiter, Tequesta, Palm Beach Gardens, Juno Beach) **'] : []),
    '',
    `Name:  ${name}`,
    `Phone: ${phone || 'Not provided'}`,
    `Email: ${email || 'Not provided'}`,
    `Photos: ${photos.length ? `${photos.length} attached` : 'none'}`,
    `Outdoor outlet: ${outlet}`,
    `SMS opt-in: ${smsConsent}`,
    '',
    'Message:',
    '--------',
    message,
    '',
    '---',
    `Sent from the ${fromCoaster ? 'coaster page' : 'contact form'} on jupiterpowerwash.com.`,
    email ? 'Hit Reply to answer the customer directly.' : 'No email given - call or text them back.',
  ].join('\n');

  try {
    await sendEmail(env, {
      to: [env.NOTIFY_EMAIL, env.LEAD_ALERT_EMAIL].filter(Boolean),
      replyTo: email || undefined,
      subject: `New lead${coasterCode ? ` [${coasterCode}]` : ''}: ${street}, ${town === 'Other' ? 'OUTSIDE AREA' : town} - ${name}${phone ? ` - ${phone}` : ''}${photos.length ? ` [${photos.length} photo${photos.length > 1 ? 's' : ''}]` : ''} (${refId})`,
      text,
      attachments: photos,
    });
  } catch (error) {
    console.error(`Lead ${refId} NOT delivered:`, error.message, JSON.stringify({ name, phone, email, street, town, message, photos: photos.length }));
    return jsonResponse({ error: `Sorry, your message didn't go through. Please call or text us at ${PHONE_DISPLAY}.` }, 502, cors);
  }

  // Branded confirmation to the customer (only if they gave an email). Never blocks or fails the lead.
  if (email) {
    const confirm = sendCustomerConfirmation(env, { name, email, street, town, photos: photos.length, refId })
      .catch(err => console.error(`Confirmation for ${refId} failed:`, err.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(confirm); else await confirm;
  }

  return jsonResponse({ success: true, messageId: refId }, 200, cors);
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendCustomerConfirmation(env, { name, email, street, town, photos, refId }) {
  const SITE = 'https://jupiterpowerwash.com';
  // Only echo short, clipped fields back (never the free-text message) so the form can't be used to mail arbitrary text.
  const first = (name.split(/\s+/)[0] || 'there').slice(0, 30);
  const where = `${street.slice(0, 80)}${town && town !== 'Other' ? `, ${town}` : ''}`;
  const outside = town === 'Other';
  const photoLine = photos
    ? `We got your ${photos > 1 ? `${photos} photos` : 'photo'} &mdash; thank you, that's exactly what we need.`
    : `<strong>Want a faster answer?</strong> Just reply to this email with a photo of what needs cleaning, or text it to ${PHONE_DISPLAY}.`;
  const photoText = photos
    ? `We got your ${photos > 1 ? `${photos} photos` : 'photo'} - thank you, that's exactly what we need.`
    : `Want a faster answer? Reply to this email with a photo of what needs cleaning, or text it to ${PHONE_DISPLAY}.`;
  const areaNote = outside
    ? `Heads up: your address may be outside our usual area (${SERVICE_AREA}). We'll let you know if we can make it.`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>We got your request - Jup Wash</title></head>
<body style="margin:0;padding:0;background:#FAF5EA;">
<div style="display:none;max-height:0;overflow:hidden;">Thanks ${escapeHtml(first)}! Here's what happens next with your free estimate.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF5EA;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFDF8;border:1px solid #D8C3A0;font-family:Georgia,'Times New Roman',Times,serif;color:#3A332A;">
  <tr><td align="center" style="padding:28px 24px 16px;border-top:6px solid #3F5F56;">
    <a href="${SITE}"><img src="${SITE}/email/jupwash_logo_600.png" width="180" alt="Jup Wash - Jupiter Power Wash" style="display:block;border:0;width:180px;height:auto;"></a>
  </td></tr>
  <tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" style="height:2px;line-height:2px;font-size:0;background:#A8824F;">&nbsp;</td></tr></table></td></tr>
  <tr><td style="padding:24px 32px 0;">
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:24px;line-height:1.3;color:#3F5F56;font-weight:normal;">Thanks, ${escapeHtml(first)} &mdash; we got your request!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5E5348;">Request for <strong style="color:#3A332A;">${escapeHtml(where)}</strong> &middot; Ref ${escapeHtml(refId)}</p>
    ${areaNote ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5E5348;">${escapeHtml(areaNote)}</p>` : ''}
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">${photoLine}</p>
  </td></tr>
  <tr><td style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF5EA;border-left:4px solid #5E8679;">
      <tr><td style="padding:18px 20px;font-family:Georgia,serif;">
        <p style="margin:0 0 10px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#A8824F;font-weight:bold;">What happens next</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.5;"><strong style="color:#3F5F56;">1.</strong> We look at your photos and your address.</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.5;"><strong style="color:#3F5F56;">2.</strong> We get back to you &mdash; usually within 24 hours &mdash; with your free estimate: <strong>half day $300</strong> or <strong>full day $550</strong>.</p>
        <p style="margin:0;font-size:15px;line-height:1.5;"><strong style="color:#3F5F56;">3.</strong> We clean. You pay on the day &mdash; cash, check or card. No surprise add-ons.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:24px 32px 8px;font-family:Georgia,serif;">
    <p style="margin:0 0 12px;font-size:15px;color:#5E5348;">Need it sooner? Call or text us:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#3F5F56" style="background:#3F5F56;">
      <a href="tel:+15615327120" style="display:inline-block;padding:14px 28px;font-family:Georgia,serif;font-size:18px;font-weight:bold;color:#FFFDF8;text-decoration:none;">561-532-7120</a>
    </td></tr></table>
    <p style="margin:12px 0 0;font-size:13px;color:#8A7E70;">Mon&ndash;Sat 8am&ndash;6pm &middot; Closed Sunday</p>
  </td></tr>
  <tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5E5348;">Tell a neighbor: share code <strong style="color:#3F5F56;letter-spacing:1px;">JUPFRIEND50</strong> &mdash; you both save $50.</p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#5E5348;">Have solar panels? We also do hand-washed solar panel cleaning for single-story homes on Saturdays &mdash; $995, or $1,795/year for two cleanings.</p>
  </td></tr>
  <tr><td align="center" bgcolor="#3F5F56" style="background:#3F5F56;padding:22px 32px;font-family:Georgia,serif;">
    <p style="margin:0 0 6px;font-size:15px;color:#FAF5EA;letter-spacing:2px;text-transform:uppercase;">Jup Wash</p>
    <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#FAF5EA;">Jupiter, FL &middot; <a href="tel:+15615327120" style="color:#FAF5EA;text-decoration:none;">561-532-7120</a> &middot; <a href="${SITE}" style="color:#C9A876;">jupiterpowerwash.com</a></p>
    <p style="margin:0 0 8px;font-size:12px;"><a href="${SITE}/privacy" style="color:#C9A876;">Privacy</a> &nbsp;&middot;&nbsp; <a href="${SITE}/terms" style="color:#C9A876;">Terms</a></p>
    <p style="margin:0;font-size:11px;line-height:1.5;color:#D8C3A0;">You're getting this because you requested an estimate on our website. Just reply if you have questions.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Thanks, ${first} - we got your request!`,
    `Request for ${where} (Ref ${refId})`,
    areaNote,
    '',
    photoText,
    '',
    'WHAT HAPPENS NEXT',
    '1. We look at your photos and your address.',
    '2. We get back to you - usually within 24 hours - with your free estimate: half day $300 or full day $550.',
    '3. We clean. You pay on the day - cash, check or card. No surprise add-ons.',
    '',
    `Need it sooner? Call or text ${PHONE_DISPLAY} (Mon-Sat 8am-6pm, closed Sunday).`,
    '',
    'Tell a neighbor: share code JUPFRIEND50 - you both save $50.',
    '',
    'Have solar panels? We also do hand-washed solar panel cleaning for single-story homes on Saturdays: $995, or $1,795/year for two cleanings.',
    '',
    'Jup Wash',
    'Jupiter, FL',
    PHONE_DISPLAY,
    SITE,
    `Privacy: ${SITE}/privacy`,
    `Terms: ${SITE}/terms`,
    '',
    "You're getting this because you requested an estimate on our website. Just reply if you have questions.",
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  await sendEmail(env, {
    fromName: 'Jupiter Power Wash',
    from: env.NOTIFY_EMAIL,
    to: email,
    replyTo: env.NOTIFY_EMAIL,
    subject: `We got your request - Jupiter Power Wash`,
    text,
    html,
  });
}

async function handleChat(request, env, cors) {
  const fallback = `I'm having a little trouble right now. Call or text us at ${PHONE_DISPLAY} for a free estimate!`;
  try {
    const body = await request.json();
    const message = clean(body.message, LIMITS.chat);
    if (!message) {
      return jsonResponse({ error: 'Message required' }, 400, cors);
    }

    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content)
        .map(h => ({ role: h.role, content: h.content.slice(0, LIMITS.historyItem) })),
      { role: 'user', content: message },
    ];

    const ai = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages,
      max_tokens: 400,
      temperature: 0.5,
    });

    const reply = typeof ai?.response === 'string' && ai.response.trim() ? ai.response.trim() : fallback;
    return jsonResponse({ response: reply }, 200, cors);
  } catch (error) {
    console.error('Chat error:', error);
    return jsonResponse({ response: fallback }, 200, cors);
  }
}

async function sendEmail(env, { to, replyTo, subject, text, html, attachments, from, fromName }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  if (!to || (Array.isArray(to) && !to.length) || !env.FROM_EMAIL) throw new Error('NOTIFY_EMAIL / FROM_EMAIL not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName || 'Jupiter Power Wash Website'} <${from || env.FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo,
      subject,
      text,
      html: html || undefined,
      attachments: attachments && attachments.length ? attachments : undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
