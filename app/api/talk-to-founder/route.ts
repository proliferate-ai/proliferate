import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FALLBACK_EMAIL = 'pablo@proliferate.ai';

export async function POST(req: NextRequest) {
  const { email, isInSF, neighborhood, when, notes } = await req.json();

  if (!email) {
    return NextResponse.json({
      ok: false,
      error: 'Email is required',
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
      INSERT INTO demo_requests (email, is_in_sf, neighborhood, preferred_time, notes, created_at, email_sent, email_error)
      VALUES (${email}, ${isInSF || false}, ${neighborhood || null}, ${when || null}, ${notes || null}, NOW(), FALSE, NULL)
    `;
    dbSuccess = true;
    console.log(`[DemoRequest] Saved to database: ${email}`);
  } catch (error) {
    dbError = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[DemoRequest] DATABASE SAVE FAILED:', dbError);
  }

  // ============================================
  // STEP 2: SEND NOTIFICATION EMAIL
  // ============================================
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TO_EMAIL = process.env.FOUNDER_EMAIL || 'pablo@proliferate.ai';

  if (!RESEND_API_KEY) {
    emailError = 'Email service not configured';
    console.error('[DemoRequest] NO RESEND_API_KEY - emails will not send!');
  } else {
    try {
      const subject = `Demo Request${isInSF ? ' (SF - In Person)' : ''} - ${email}`;
      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <h2 style="color: #1a1a1a;">New Demo Request${isInSF ? ' (In SF!)' : ''}</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p style="margin: 8px 0;"><strong>In SF:</strong> ${isInSF ? 'Yes' : 'No'}</p>
            ${neighborhood ? `<p style="margin: 8px 0;"><strong>Neighborhood:</strong> ${neighborhood}</p>` : ''}
            ${when ? `<p style="margin: 8px 0;"><strong>Preferred time:</strong> ${when}</p>` : ''}
            ${notes ? `<p style="margin: 8px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
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
      console.log('[DemoRequest] Notification email sent:', data.id);

      // Update DB to mark email as sent
      if (dbSuccess) {
        try {
          await sql`UPDATE demo_requests SET email_sent = TRUE WHERE email = ${email} ORDER BY created_at DESC LIMIT 1`;
        } catch {
          console.error('[DemoRequest] Failed to update email_sent flag');
        }
      }

    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Unknown email error';
      console.error('[DemoRequest] EMAIL SEND FAILED:', emailError);

      if (dbSuccess) {
        try {
          await sql`UPDATE demo_requests SET email_error = ${emailError} WHERE email = ${email} ORDER BY created_at DESC LIMIT 1`;
        } catch {
          console.error('[DemoRequest] Failed to update email_error in DB');
        }
      }
    }
  }

  // ============================================
  // STEP 3: DETERMINE RESPONSE
  // ============================================

  if (dbSuccess && emailSuccess) {
    return NextResponse.json({ ok: true });
  }

  if (dbSuccess && !emailSuccess) {
    console.warn('[DemoRequest] Partial success: saved to DB but email failed');
    return NextResponse.json({ ok: true });
  }

  const errorMessage = `We encountered a technical issue. Please email ${FALLBACK_EMAIL} directly. We apologize for the inconvenience!`;

  console.error('[DemoRequest] CRITICAL FAILURE - DB save failed!', { email, isInSF, dbError, emailError });

  return NextResponse.json({
    ok: false,
    error: errorMessage,
    fallbackEmail: FALLBACK_EMAIL,
    critical: true
  }, { status: 500 });
}
