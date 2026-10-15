/**
 * Jupiter Power Wash - Contact API
 * Cloudflare Worker for handling the contact form and the AI chatbot
 * Sends email notifications. No database - stateless.
 * AI Chatbot powered by Cloudflare Workers AI
 */

const SYSTEM_PROMPT = `You are Splash, the friendly AI assistant for Jupiter Power Wash, a professional pressure washing company in Jupiter, Florida. You're helpful, warm, and knowledgeable about pressure washing services.

ABOUT JUPITER POWER WASH:
- Family-owned, local business serving Jupiter, FL and surrounding areas (Palm Beach Gardens, Tequesta, Hobe Sound, Stuart)
- Core services: Driveways, Patios, Pool Areas, Sidewalks
- Phone: 561.532.7120 (best way to get a free estimate - encourage people to call!)
- Email: clean@jupiterpowerwash.com
- Website: jupiterpowerwash.com
- Payment is collected on the day of the job - cash, check, or card. No online prepayment needed.

SERVICES & TYPICAL PRICING (estimates, final quote depends on size/condition):
- Driveway: $100-$250
- Patio: $150-$350
- Pool Area/Deck: $200-$450
- Sidewalk: $75-$150
- Full Property Package: $500-$1000

YOUR ROLE:
1. Welcome visitors warmly
2. Answer questions about services, pricing, and the company
3. There is NO online booking - when someone wants to schedule a job or get a quote, tell them to call or text 561-532-7120 and they'll get a free estimate. Don't try to collect their info and book it yourself.
4. Be conversational and friendly - you're representing a local family business

Keep responses concise but friendly. Use casual language appropriate for Florida - warm and welcoming!`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Route handling
    if (request.method === 'POST') {
      if (url.pathname === '/api/contact') {
        return handleContact(request, env);
      }
      if (url.pathname === '/api/chat') {
        return handleChat(request, env);
      }
    }

    return new Response('Jupiter Power Wash API', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

async function handleContact(request, env) {
  try {
    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.email || !data.message) {
      return jsonResponse({ error: 'Please fill in all required fields' }, 400);
    }

    const refId = Date.now().toString(36).toUpperCase();

    const emailBody = `
NEW MESSAGE - Jupiter Power Wash Website
Ref: ${refId}

From: ${data.name}
Email: ${data.email}
Phone: ${data.phone || 'Not provided'}

Message:
--------
${data.message}

---
Submitted via jupiterpowerwash.com contact form
    `.trim();

    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      replyTo: data.email,
      subject: `Contact ${refId}: ${data.name}`,
      body: emailBody,
    });

    return jsonResponse({
      success: true,
      messageId: refId,
      message: 'Message sent! We\'ll get back to you soon.'
    });

  } catch (error) {
    console.error('Contact error:', error);
    return jsonResponse({ error: 'Failed to send message. Please call 561.532.7120' }, 500);
  }
}

async function handleChat(request, env) {
  try {
    const { message, history } = await request.json();

    if (!message) {
      return jsonResponse({ error: 'Message required' }, 400);
    }

    // Conversation history is passed in from the browser (no server-side storage) -
    // keep it short so we don't blow past the model's context window.
    const recentHistory = Array.isArray(history) ? history.slice(-12) : [];

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentHistory
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    // Call Cloudflare Workers AI
    const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    return jsonResponse({ response: aiResponse.response });

  } catch (error) {
    console.error('Chat error:', error);
    return jsonResponse({
      response: "I'm having a little trouble right now. You can call us directly at 561.532.7120 for a free estimate!"
    });
  }
}

async function sendEmail(env, { to, replyTo, subject, body }) {
  const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: to }],
      }],
      from: {
        email: env.FROM_EMAIL,
        name: 'Jupiter Power Wash',
      },
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject: subject,
      content: [{
        type: 'text/plain',
        value: body,
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Email failed: ${error}`);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
