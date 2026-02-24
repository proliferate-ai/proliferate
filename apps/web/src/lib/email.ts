import { logger } from "@/lib/logger";
import { env, features } from "@proliferate/environment/server";
import { Resend } from "resend";

const log = logger.child({ module: "email" });
const resend = features.emailEnabled ? new Resend(env.RESEND_API_KEY) : null;

// ---------------------------------------------------------------------------
// Public: feature check
// ---------------------------------------------------------------------------

export function isEmailEnabled(): boolean {
	return resend !== null;
}

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function layout(body: string): string {
	return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">${body}</div>`;
}

function heading(text: string): string {
	return `<h2>${escapeHtml(text)}</h2>`;
}

function paragraph(html: string, style?: string): string {
	const attr = style ? ` style="${style}"` : "";
	return `<p${attr}>${html}</p>`;
}

function ctaButton(label: string, url: string): string {
	return `<a href="${url}" style="background: #000; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none;">${escapeHtml(label)}</a>`;
}

function muted(text: string): string {
	return paragraph(escapeHtml(text), "color: #666; font-size: 14px;");
}

// ---------------------------------------------------------------------------
// Internal: send via Resend
// ---------------------------------------------------------------------------

async function send(params: { to: string; subject: string; html: string }): Promise<void> {
	if (!resend) {
		throw new Error("Attempted to send email but email is disabled.");
	}
	await resend.emails.send({
		from: env.EMAIL_FROM ?? "",
		...params,
	});
}

// ---------------------------------------------------------------------------
// Email: verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
	user: { name: string; email: string },
	url: string,
): Promise<void> {
	log.info({ to: user.email }, "Sending verification email");
	await send({
		to: user.email,
		subject: "Verify your email address",
		html: layout(
			heading("Verify your email") +
				paragraph(`Hi ${escapeHtml(user.name)},`) +
				paragraph("Please verify your email address to complete your registration.") +
				paragraph(ctaButton("Verify Email", url), "margin: 24px 0;") +
				muted("If the button doesn't work, copy and paste this link into your browser."),
		),
	});
}

// ---------------------------------------------------------------------------
// Email: organization invitation
// ---------------------------------------------------------------------------

export async function sendInvitationEmail(data: {
	email: string;
	id: string;
	organization: { name: string };
	inviter: { user: { name: string } };
	role: string;
}): Promise<void> {
	const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${data.id}`;
	log.info({ to: data.email, orgName: data.organization.name }, "Sending invitation email");
	await send({
		to: data.email,
		subject: `You've been invited to join ${data.organization.name}`,
		html: layout(
			heading("You're invited!") +
				paragraph(
					`${escapeHtml(data.inviter.user.name)} has invited you to join <strong>${escapeHtml(data.organization.name)}</strong> on Proliferate.`,
				) +
				paragraph(`You'll be joining as a <strong>${escapeHtml(data.role)}</strong>.`) +
				paragraph(ctaButton("Accept Invitation", inviteUrl), "margin: 24px 0;") +
				muted("This invitation expires in 7 days."),
		),
	});
}

// ---------------------------------------------------------------------------
// Email: integration request (sent to admin)
// ---------------------------------------------------------------------------

export async function sendIntegrationRequestEmail(data: {
	userName: string;
	userEmail: string;
	orgName: string;
	integrationName: string;
}): Promise<void> {
	log.info(
		{ integration: data.integrationName, orgName: data.orgName },
		"Sending integration request email",
	);
	await send({
		to: env.EMAIL_FROM ?? "",
		subject: `Integration request: ${data.integrationName}`,
		html: layout(
			paragraph(
				`<strong>${escapeHtml(data.userName)}</strong> from <strong>${escapeHtml(data.orgName)}</strong> requested:`,
			) +
				paragraph(escapeHtml(data.integrationName), "font-size: 18px; padding: 12px 0;") +
				muted(`User email: ${escapeHtml(data.userEmail)}`),
		),
	});
}
