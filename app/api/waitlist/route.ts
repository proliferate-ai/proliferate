import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { name, email } = await req.json();

    // Validate input
    if (!name || !email) {
      return NextResponse.json({ ok: false, error: 'Name and email are required' }, { status: 400 });
    }

    const subject = `New Early Access Request - ${name}`;
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <h2 style="color: #1a1a1a;">New Early Access Request 🎉</h2>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 8px 0;"><strong>Company:</strong> ${name}</p>
          <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p style="margin: 8px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p style="color: #666; font-size: 14px;">This request was submitted through the "Join early access" form on your landing page.</p>
      </div>
    `;

    const textBody = `New Early Access Request\n\nCompany: ${name}\nEmail: ${email}\nTime: ${new Date().toLocaleString()}`;

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TO_EMAIL = process.env.FOUNDER_EMAIL || 'founder@withproliferate.com';

    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: [TO_EMAIL],
          subject,
          text: textBody,
          html: htmlBody,
          reply_to: email,
        }),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Resend API error:', errorText);
        return NextResponse.json({ ok: false, error: 'Failed to send notification' }, { status: 500 });
      }
      
      const data = await res.json();
      console.log('Waitlist email sent successfully:', data.id);

      // Optionally send a welcome email to the user
      const welcomeRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: [email],
          subject: 'Welcome to Proliferate Early Access!',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #1a1a1a;">Welcome to Proliferate! 🚀</h1>
              <p>Hi ${name},</p>
              <p>Thank you for your interest in Proliferate! You're now on our exclusive early access list.</p>
              <p>We're building the AI platform that automatically fixes production bugs, and we can't wait to show you what we've been working on.</p>
              <p><strong>What happens next?</strong></p>
              <ul>
                <li>We'll review your application</li>
                <li>You'll receive an invitation when your spot is ready</li>
                <li>Get exclusive early access pricing and features</li>
              </ul>
              <p>In the meantime, feel free to reply to this email if you have any questions!</p>
              <p>Best,<br>The Proliferate Team</p>
            </div>
          `,
          text: `Welcome to Proliferate!\n\nHi ${name},\n\nThank you for your interest in Proliferate! You're now on our exclusive early access list.\n\nWe're building the AI platform that automatically fixes production bugs, and we can't wait to show you what we've been working on.\n\nWhat happens next?\n- We'll review your application\n- You'll receive an invitation when your spot is ready\n- Get exclusive early access pricing and features\n\nIn the meantime, feel free to reply to this email if you have any questions!\n\nBest,\nThe Proliferate Team`
        }),
      });

      if (!welcomeRes.ok) {
        console.error('Failed to send welcome email, but waitlist entry was successful');
      }
    } else {
      console.log('[Waitlist] No RESEND_API_KEY found, logging:', { name, email });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in waitlist API:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}