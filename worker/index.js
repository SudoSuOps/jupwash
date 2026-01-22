/**
 * Jupiter Power Wash - Booking & Contact API
 * Cloudflare Worker for handling form submissions
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

    // Format the booking email
    const emailBody = `
NEW BOOKING REQUEST - Jupiter Power Wash

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
This booking was submitted via jupiterpowerwash.com
Reply to this email or call ${data.phone} to confirm.
    `.trim();

    // Send email via MailChannels
    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      replyTo: data.email,
      subject: `New Booking: ${formatService(data.service)} - ${data.name}`,
      body: emailBody,
    });

    // Send confirmation to customer
    const confirmationBody = `
Hi ${data.name},

Thank you for booking with Jupiter Power Wash!

We've received your request for ${formatService(data.service)} on ${data.date} at ${data.time}.

Booking Details:
- Service: ${formatService(data.service)}
- Date: ${data.date}
- Time: ${data.time}
- Address: ${data.address}

We'll contact you shortly at ${data.phone} to confirm your appointment.

If you have any questions, call us at 561.532.7120 or reply to this email.

Thank you for choosing Jupiter Power Wash!

- The Jupiter Power Wash Team
    `.trim();

    await sendEmail(env, {
      to: data.email,
      subject: `Booking Confirmation - Jupiter Power Wash`,
      body: confirmationBody,
    });

    return jsonResponse({
      success: true,
      message: 'Booking received! Check your email for confirmation.'
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

    const emailBody = `
NEW MESSAGE - Jupiter Power Wash Website

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
      subject: `Contact Form: ${data.name}`,
      body: emailBody,
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
    throw new Error(`Email failed: ${error}`);
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
