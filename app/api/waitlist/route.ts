import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FALLBACK_EMAIL = 'pablo@proliferate.ai';

export async function POST(req: NextRequest) {
  const { name, email } = await req.json();

  // Validate input
  if (!name || !email) {
    return NextResponse.json({
      ok: false,
      error: 'Name and email are required',
      fallbackEmail: FALLBACK_EMAIL
    }, { status: 400 });
  }

  let dbSuccess = false;
  let emailSuccess = false;
  let dbError: string | null = null;
  let emailError: string | null = null;

  // ============================================
  // STEP 1: STORE IN DATABASE (CRITICAL)
  // ============================================
  try {
    await sql`
      INSERT INTO waitlist (name, email, created_at, email_sent, email_error)
      VALUES (${name}, ${email}, NOW(), FALSE, NULL)
    `;
    dbSuccess = true;
    console.log(`[Waitlist] Saved to database: ${email}`);
  } catch (error) {
    dbError = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[Waitlist] DATABASE SAVE FAILED:', dbError);
  }

  // ============================================
  // STEP 2: SEND NOTIFICATION EMAIL
  // ============================================
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TO_EMAIL = process.env.FOUNDER_EMAIL || 'pablo@proliferate.ai';

  if (!RESEND_API_KEY) {
    emailError = 'Email service not configured';
    console.error('[Waitlist] NO RESEND_API_KEY - emails will not send!');
  } else {
    try {
      const subject = `New Early Access Request - ${name}`;
      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <h2 style="color: #1a1a1a;">New Early Access Request</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 8px 0;"><strong>Company:</strong> ${name}</p>
            <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p style="margin: 8px 0;"><strong>Time:</strong> ${new Date().toISOString()}</p>
            <p style="margin: 8px 0;"><strong>Saved to DB:</strong> ${dbSuccess ? 'YES' : 'NO - ' + dbError}</p>
          </div>
        </div>
      `;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'hello@proliferatemail.com',
          to: [TO_EMAIL],
          subject,
          html: htmlBody,
          reply_to: email,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Resend API error: ${errorText}`);
      }

      const data = await res.json();
      emailSuccess = true;
      console.log('[Waitlist] Notification email sent:', data.id);

      // Update DB to mark email as sent
      if (dbSuccess) {
        try {
          await sql`UPDATE waitlist SET email_sent = TRUE WHERE email = ${email} ORDER BY created_at DESC LIMIT 1`;
        } catch {
          // Non-critical, just log
          console.error('[Waitlist] Failed to update email_sent flag');
        }
      }

      // Send welcome email to user
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'hello@proliferatemail.com',
            to: [email],
            subject: 'Welcome to Proliferate Early Access!',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #1a1a1a;">Welcome to Proliferate!</h1>
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
          }),
        });
        console.log('[Waitlist] Welcome email sent to user');
      } catch (welcomeErr) {
        // Non-critical - we already have their info
        console.error('[Waitlist] Welcome email failed (non-critical):', welcomeErr);
      }

    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Unknown email error';
      console.error('[Waitlist] EMAIL SEND FAILED:', emailError);

      // Update DB with email error
      if (dbSuccess) {
        try {
          await sql`UPDATE waitlist SET email_error = ${emailError} WHERE email = ${email} ORDER BY created_at DESC LIMIT 1`;
        } catch {
          console.error('[Waitlist] Failed to update email_error in DB');
        }
      }
    }
  }

  // ============================================
  // STEP 3: DETERMINE RESPONSE
  // ============================================

  // BOTH SUCCEEDED - All good!
  if (dbSuccess && emailSuccess) {
    return NextResponse.json({ ok: true });
  }

  // DB SUCCEEDED but EMAIL FAILED - Acceptable, we have the data
  if (dbSuccess && !emailSuccess) {
    console.warn('[Waitlist] Partial success: saved to DB but email failed');
    return NextResponse.json({ ok: true }); // Don't scare the user, we have their info
  }

  // DB FAILED - THIS IS CRITICAL, WE MIGHT LOSE THE LEAD
  // Show a very clear error and ask them to email directly
  const errorMessage = `We encountered a technical issue saving your information. Please email ${FALLBACK_EMAIL} directly with your company name and email. We apologize for the inconvenience!`;

  console.error('[Waitlist] CRITICAL FAILURE - DB save failed!', { name, email, dbError, emailError });

  return NextResponse.json({
    ok: false,
    error: errorMessage,
    fallbackEmail: FALLBACK_EMAIL,
    critical: true
  }, { status: 500 });
}
