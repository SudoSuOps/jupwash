/**
 * Jupiter Power Wash - Website API (Cloudflare Worker)
 *
 *   POST /api/contact  -> emails the lead to NOTIFY_EMAIL via Resend
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
- Services: driveways, patios, pool areas / pool decks, sidewalks, and solar panel cleaning (specialty, see below).
- Service area: ${SERVICE_AREA}. If someone is outside this, tell them to call and ask - don't promise.
- Phone (call or text): ${PHONE_DISPLAY}. This is the fastest way to get a free estimate.
- Email: clean@jupiterpowerwash.com
- Payment is collected on the day of the job (cash, check or card). No online prepayment.
- Equipment: our pressure washers are electric - much quieter than gas machines, no exhaust fumes at the customer's home. We need an outdoor electrical outlet; if there isn't one, we bring our own generator - no problem. Don't quote any generator fee. Don't call it "zero emissions" or make other environmental claims beyond quiet / no exhaust at the home.
- Referral offer: code JUPFRIEND50 - the customer and the friend they refer each save $50.
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
2. If asked about a service not listed above (roofs, house walls, windows, gutters, etc.), say you're not sure it's offered and ask them to call ${PHONE_DISPLAY} to ask. Never recommend or name other companies.
3. Don't invent facts: no made-up hours, guarantees, licenses, discounts or availability. If you don't know, say so and give the phone number.
4. Keep answers short (2-4 sentences), warm and casual. Plain text only, no markdown.`;

const ALLOWED_ORIGINS = new Set([
  'https://jupiterpowerwash.com',
  'https://www.jupiterpowerwash.com',
  'https://jupwash.pages.dev',
]);

const TOWNS = ['Jupiter', 'Tequesta', 'Palm Beach Gardens', 'Juno Beach'];

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
    out.push({ filename: `${out.length + 1}-${base}.jpg`, content: p.content });
  }
  return out;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/contact') {
      return handleContact(request, env, cors);
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

async function handleContact(request, env, cors) {
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

  if (!name || !message || (!email && !phone)) {
    return jsonResponse({ error: 'Please add your name, a message, and an email or phone number.' }, 400, cors);
  }
  if (!street || !town) {
    return jsonResponse({ error: 'Please add the street address and town where the job is.' }, 400, cors);
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
    '',
    `Address: ${address}`,
    `Map:     ${mapsUrl}`,
    town === 'Other' ? '** OUTSIDE SERVICE AREA (Jupiter, Tequesta, Palm Beach Gardens, Juno Beach) **' : '',
    '',
    `Name:  ${name}`,
    `Phone: ${phone || 'Not provided'}`,
    `Email: ${email || 'Not provided'}`,
    `Photos: ${photos.length ? `${photos.length} attached` : 'none'}`,
    `Outdoor outlet: ${outlet}`,
    '',
    'Message:',
    '--------',
    message,
    '',
    '---',
    'Sent from the contact form on jupiterpowerwash.com.',
    email ? 'Hit Reply to answer the customer directly.' : 'No email given - call or text them back.',
  ].join('\n');

  try {
    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      replyTo: email || undefined,
      subject: `New lead: ${street}, ${town === 'Other' ? 'OUTSIDE AREA' : town} - ${name}${phone ? ` - ${phone}` : ''}${photos.length ? ` [${photos.length} photo${photos.length > 1 ? 's' : ''}]` : ''} (${refId})`,
      text,
      attachments: photos,
    });
  } catch (error) {
    console.error(`Lead ${refId} NOT delivered:`, error.message, JSON.stringify({ name, phone, email, street, town, message, photos: photos.length }));
    return jsonResponse({ error: `Sorry, your message didn't go through. Please call or text us at ${PHONE_DISPLAY}.` }, 502, cors);
  }

  return jsonResponse({ success: true, messageId: refId }, 200, cors);
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

async function sendEmail(env, { to, replyTo, subject, text, attachments }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  if (!to || !env.FROM_EMAIL) throw new Error('NOTIFY_EMAIL / FROM_EMAIL not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Jupiter Power Wash Website <${env.FROM_EMAIL}>`,
      to: [to],
      reply_to: replyTo,
      subject,
      text,
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
