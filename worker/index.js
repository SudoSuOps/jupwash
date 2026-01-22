/**
 * Jupiter Power Wash - Booking & Contact API
 * Cloudflare Worker for handling form submissions
 * Sends notifications to Discord webhook
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    // Send to Discord
    await sendDiscord(env, {
      title: '🧹 New Booking Request',
      color: 0x00d4ff, // Cyan
      fields: [
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

    return jsonResponse({
      success: true,
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

    // Send to Discord
    await sendDiscord(env, {
      title: '💬 New Contact Message',
      color: 0xf97316, // Orange
      fields: [
        { name: '👤 From', value: data.name, inline: true },
        { name: '📧 Email', value: data.email, inline: true },
        { name: '📱 Phone', value: data.phone || 'Not provided', inline: true },
        { name: '💬 Message', value: data.message, inline: false },
      ],
      footer: 'Jupiter Power Wash | jupiterpowerwash.com',
    });

    return jsonResponse({
      success: true,
      message: 'Message sent! We\'ll get back to you soon.'
    });

  } catch (error) {
    console.error('Contact error:', error);
    return jsonResponse({ error: 'Failed to send message. Please call 561.532.7120' }, 500);
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
