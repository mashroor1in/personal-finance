/**
 * Early access waitlist API endpoint
 * 
 * This endpoint handles waitlist signups for the early access program.
 * In a production environment, this would integrate with a database or
 * external service to store email addresses.
 */

export async function onRequest(context) {
  // Handle CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 200,
    });
  }

  // Handle POST requests (waitlist signup)
  if (context.request.method === 'POST') {
    try {
      const data = await context.request.json();
      const email = data.email?.trim();

      // Validate email
      if (!email) {
        return new Response(JSON.stringify({ error: 'Email is required' }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      // Simple email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(JSON.stringify({ error: 'Please enter a valid email address' }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      // In a production environment, you would:
      // 1. Store the email in a database
      // 2. Add to a mailing list service (Mailchimp, etc.)
      // 3. Send a confirmation email
      // 4. Track analytics

      // For now, just return success
      console.log(`Waitlist signup: ${email}`);
      console.log(`Timestamp: ${new Date().toISOString()}`);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Successfully joined the waitlist',
        email: email,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });

    } catch (error) {
      console.error('Error processing waitlist signup:', error);
      return new Response(JSON.stringify({ error: 'An error occurred while processing your request' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  // Handle GET requests (return waitlist info)
  if (context.request.method === 'GET') {
    return new Response(JSON.stringify({ 
      message: 'Bucksy Early Access Waitlist API',
      status: 'active',
      endpoint: '/early-access/api/waitlist'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // Handle other methods
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}