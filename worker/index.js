/**
 * Jupiter Power Wash - Booking & Contact API
 * Cloudflare Worker for handling form submissions
 * Sends notifications to Discord + Email + Stores in D1 Database
 * AI Chatbot powered by Cloudflare Workers AI
 */

const SYSTEM_PROMPT = `You are Splash, the friendly AI assistant for Jupiter Power Wash, a professional pressure washing company in Jupiter, Florida. You're helpful, warm, and knowledgeable about pressure washing services.

ABOUT JUPITER POWER WASH:
- Family-owned business serving Jupiter, FL and surrounding areas (Palm Beach Gardens, Tequesta, Hobe Sound, Stuart)
- Services: House exteriors, driveways, decks/patios, pool cages, commercial properties
- Phone: 561.532.7120
- Email: service@jupiterpowerwash.com
- Website: jupiterpowerwash.com
- Accepts USDC crypto payments at jupwash.eth

SERVICES & TYPICAL PRICING (estimates, final quote depends on size/condition):
- House Exterior: $200-$500
- Driveway: $100-$250
- Deck/Patio: $150-$350
- Pool Cage: $200-$450
- Full Property Package: $500-$1000
- Commercial: Custom quotes

YOUR ROLE:
1. Welcome visitors warmly
2. Answer questions about services, pricing, and the company
3. Help customers book appointments by collecting: name, email, phone, service type, preferred date, preferred time, and property address
4. Be conversational and friendly - you're representing a local family business

BOOKING FLOW:
When a customer wants to book, collect this information naturally through conversation:
- Their name
- Email address
- Phone number
- Which service they need
- Preferred date
- Preferred time (morning 8-12, afternoon 12-4, or evening 4-7)
- Property address

Once you have ALL the information, confirm the details and say you're submitting their booking request. Include a JSON block at the end of your message in this exact format:
###BOOKING_DATA###
{"name": "...", "email": "...", "phone": "...", "service": "...", "date": "...", "time": "...", "address": "..."}
###END_BOOKING###

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
      if (url.pathname === '/api/booking') {
        return handleBooking(request, env);
      }
      if (url.pathname === '/api/contact') {
        return handleContact(request, env);
      }
      if (url.pathname === '/api/chat') {
        return handleChat(request, env);
      }
    }

    // GET endpoints for viewing data (could be protected in production)
    if (request.method === 'GET') {
      if (url.pathname === '/api/bookings') {
        return getBookings(env);
      }
      if (url.pathname === '/api/contacts') {
        return getContacts(env);
      }
    }

    return new Response('Jupiter Power Wash API', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

async function handleBooking(request, env) {
  try {
    const data = await request.json();

    // Validate required fields
    const required = ['name', 'email', 'phone', 'service', 'date', 'time', 'address'];
    for (const field of required) {
      if (!data[field]) {
        return jsonResponse({ error: `Missing required field: ${field}` }, 400);
      }
    }

    // Store in D1 database
    const dbResult = await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, service, date, time, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.name, data.email, data.phone, data.service,
      data.date, data.time, data.address, data.notes || ''
    ).run();

    const bookingId = dbResult.meta?.last_row_id || 'N/A';

    // Send to Discord
    await sendDiscord(env, {
      title: '🧹 New Booking Request',
      color: 0x00d4ff,
      fields: [
        { name: '🆔 Booking ID', value: `#${bookingId}`, inline: true },
        { name: '👤 Customer', value: data.name, inline: true },
        { name: '📧 Email', value: data.email, inline: true },
        { name: '📱 Phone', value: data.phone, inline: true },
        { name: '🔧 Service', value: formatService(data.service), inline: true },
        { name: '📅 Date', value: data.date, inline: true },
        { name: '⏰ Time', value: data.time, inline: true },
        { name: '📍 Address', value: data.address, inline: false },
        { name: '📝 Notes', value: data.notes || 'None', inline: false },
      ],
      footer: 'Jupiter Power Wash | jupiterpowerwash.com',
    });

    // Send email notification
    const emailBody = `
NEW BOOKING REQUEST - Jupiter Power Wash
Booking ID: #${bookingId}

Customer Details:
-----------------
Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}

Service Requested:
------------------
Service: ${formatService(data.service)}
Date: ${data.date}
Time: ${data.time}

Property Address:
-----------------
${data.address}

Additional Notes:
-----------------
${data.notes || 'None'}

---
Submitted via jupiterpowerwash.com
Reply to this email or call ${data.phone} to confirm.
    `.trim();

    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      replyTo: data.email,
      subject: `New Booking #${bookingId}: ${formatService(data.service)} - ${data.name}`,
      body: emailBody,
    });

    return jsonResponse({
      success: true,
      bookingId: bookingId,
      message: 'Booking received! We\'ll contact you shortly to confirm.'
    });

  } catch (error) {
    console.error('Booking error:', error);
    return jsonResponse({ error: 'Failed to process booking. Please call 561.532.7120' }, 500);
  }
}

async function handleContact(request, env) {
  try {
    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.email || !data.message) {
      return jsonResponse({ error: 'Please fill in all required fields' }, 400);
    }

    // Store in D1 database
    const dbResult = await env.DB.prepare(
      `INSERT INTO contacts (name, email, phone, message) VALUES (?, ?, ?, ?)`
    ).bind(data.name, data.email, data.phone || '', data.message).run();

    const contactId = dbResult.meta?.last_row_id || 'N/A';

    // Send to Discord
    await sendDiscord(env, {
      title: '💬 New Contact Message',
      color: 0xf97316,
      fields: [
        { name: '🆔 Message ID', value: `#${contactId}`, inline: true },
        { name: '👤 From', value: data.name, inline: true },
        { name: '📧 Email', value: data.email, inline: true },
        { name: '📱 Phone', value: data.phone || 'Not provided', inline: true },
        { name: '💬 Message', value: data.message, inline: false },
      ],
      footer: 'Jupiter Power Wash | jupiterpowerwash.com',
    });

    // Send email notification
    const emailBody = `
NEW MESSAGE - Jupiter Power Wash Website
Message ID: #${contactId}

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
      subject: `Contact #${contactId}: ${data.name}`,
      body: emailBody,
    });

    return jsonResponse({
      success: true,
      messageId: contactId,
      message: 'Message sent! We\'ll get back to you soon.'
    });

  } catch (error) {
    console.error('Contact error:', error);
    return jsonResponse({ error: 'Failed to send message. Please call 561.532.7120' }, 500);
  }
}

async function handleChat(request, env) {
  try {
    const { message, sessionId } = await request.json();

    if (!message || !sessionId) {
      return jsonResponse({ error: 'Message and sessionId required' }, 400);
    }

    // Load conversation history from D1
    const { results: history } = await env.DB.prepare(
      `SELECT role, content FROM conversations
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT 20`
    ).bind(sessionId).all();

    // Build messages array for AI
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    // Call Cloudflare Workers AI
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const assistantMessage = aiResponse.response;

    // Store conversation in D1
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)'
      ).bind(sessionId, 'user', message),
      env.DB.prepare(
        'INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)'
      ).bind(sessionId, 'assistant', assistantMessage),
    ]);

    // Check if AI collected booking data
    let bookingCreated = null;
    const bookingMatch = assistantMessage.match(/###BOOKING_DATA###\s*([\s\S]*?)\s*###END_BOOKING###/);

    if (bookingMatch) {
      try {
        const bookingData = JSON.parse(bookingMatch[1]);

        // Create the booking
        const dbResult = await env.DB.prepare(
          `INSERT INTO bookings (name, email, phone, service, date, time, address, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          bookingData.name,
          bookingData.email,
          bookingData.phone,
          bookingData.service,
          bookingData.date,
          bookingData.time,
          bookingData.address,
          'Booked via AI chatbot'
        ).run();

        const bookingId = dbResult.meta?.last_row_id || 'N/A';
        bookingCreated = { id: bookingId, ...bookingData };

        // Send Discord notification
        await sendDiscord(env, {
          title: '🤖 New AI Chatbot Booking',
          color: 0x00d4ff,
          fields: [
            { name: '🆔 Booking ID', value: `#${bookingId}`, inline: true },
            { name: '👤 Customer', value: bookingData.name, inline: true },
            { name: '📧 Email', value: bookingData.email, inline: true },
            { name: '📱 Phone', value: bookingData.phone, inline: true },
            { name: '🔧 Service', value: bookingData.service, inline: true },
            { name: '📅 Date', value: bookingData.date, inline: true },
            { name: '⏰ Time', value: bookingData.time, inline: true },
            { name: '📍 Address', value: bookingData.address, inline: false },
            { name: '🤖 Source', value: 'AI Chatbot (Splash)', inline: false },
          ],
          footer: 'Jupiter Power Wash | AI Booking',
        });

        // Send email notification
        await sendEmail(env, {
          to: env.NOTIFY_EMAIL,
          replyTo: bookingData.email,
          subject: `AI Booking #${bookingId}: ${bookingData.service} - ${bookingData.name}`,
          body: `NEW AI CHATBOT BOOKING - Jupiter Power Wash
Booking ID: #${bookingId}

Customer: ${bookingData.name}
Email: ${bookingData.email}
Phone: ${bookingData.phone}

Service: ${bookingData.service}
Date: ${bookingData.date}
Time: ${bookingData.time}

Address: ${bookingData.address}

---
Booked via AI Chatbot (Splash)
jupiterpowerwash.com`,
        });

      } catch (e) {
        console.error('Failed to create booking from AI:', e);
      }
    }

    // Clean the response to remove booking JSON if present
    let cleanResponse = assistantMessage.replace(/###BOOKING_DATA###[\s\S]*?###END_BOOKING###/, '').trim();

    return jsonResponse({
      response: cleanResponse,
      bookingCreated: bookingCreated,
    });

  } catch (error) {
    console.error('Chat error:', error);
    return jsonResponse({
      response: "I'm having a little trouble right now. You can call us directly at 561.532.7120 or use the booking form above!"
    });
  }
}

async function getBookings(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM bookings ORDER BY created_at DESC LIMIT 100'
    ).all();
    return jsonResponse({ bookings: results });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch bookings' }, 500);
  }
}

async function getContacts(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM contacts ORDER BY created_at DESC LIMIT 100'
    ).all();
    return jsonResponse({ contacts: results });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch contacts' }, 500);
  }
}

async function sendDiscord(env, { title, color, fields, footer }) {
  const response = await fetch(env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: title,
        color: color,
        fields: fields,
        footer: { text: footer },
        timestamp: new Date().toISOString(),
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord webhook failed: ${error}`);
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

function formatService(serviceKey) {
  const services = {
    'residential-house': 'Residential - House Exterior',
    'residential-driveway': 'Residential - Driveway',
    'residential-deck': 'Residential - Deck/Patio',
    'residential-pool': 'Residential - Pool Cage',
    'residential-full': 'Residential - Full Property',
    'commercial-storefront': 'Commercial - Storefront',
    'commercial-building': 'Commercial - Building',
    'commercial-parking': 'Commercial - Parking Lot',
    'other': 'Other',
  };
  return services[serviceKey] || serviceKey;
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
