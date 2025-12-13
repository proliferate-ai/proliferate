import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, isInSF, neighborhood, when, notes } = await req.json();

    const subject = `Talk to founder request${isInSF ? ' (SF)' : ''}`;
    const body = `Email: ${email}
In SF: ${isInSF ? 'Yes' : 'No'}
Neighborhood: ${neighborhood || '-'}
When: ${when || '-'}
Notes: ${notes || '-'}`;

    // If you have RESEND_API_KEY set, send email via Resend, otherwise log
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
          text: body,
          html: `<div>
            <h3>${subject}</h3>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>In SF:</strong> ${isInSF ? 'Yes' : 'No'}</p>
            <p><strong>Neighborhood:</strong> ${neighborhood || '-'}</p>
            <p><strong>When:</strong> ${when || '-'}</p>
            <p><strong>Notes:</strong> ${notes || '-'}</p>
          </div>`
        }),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Resend API error:', errorText);
        return NextResponse.json({ ok: false, error: 'Failed to send email' }, { status: 500 });
      }
      
      const data = await res.json();
      console.log('Email sent successfully:', data.id);
    } else {
      console.log('[TalkToFounder] No RESEND_API_KEY found, logging:', { email, isInSF, neighborhood, when, notes });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in talk-to-founder API:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}


