import { Resend } from "resend";
import { normalizeLanguage } from "../utils/normalizeLanguage.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_FROM = process.env.EMAIL_FROM || "PunDad <noreply@pundad.app>";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "support@pundad.app";
const CONTACT_ADMIN_EMAIL = process.env.CONTACT_ADMIN_EMAIL || "contact@pundad.app";
const CONTACT_TOPIC_EMAILS = Object.freeze({
  BUG: process.env.CONTACT_BUG_EMAIL || "bugs@pundad.app",
  FEATURE: process.env.CONTACT_FEATURE_EMAIL || "features@pundad.app",
  SUGGESTION: process.env.CONTACT_SUGGESTION_EMAIL || "suggestions@pundad.app",
  FEEDBACK: process.env.CONTACT_FEEDBACK_EMAIL || "feedback@pundad.app",
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getResetPasswordContent(resetUrl, language = "EN") {
  const lang = normalizeLanguage(language);
  if (lang === "NO") {
    return {
      subject: "Tilbakestill passordet ditt",
      text: `Klikk på lenken for å tilbakestille passordet ditt. Lenken utløper om 5 minutter.\n\n${resetUrl}`,
      html: `
        <h2>PunDad - Tilbakestilling av passord</h2>
        <p>Klikk på lenken under for å tilbakestille passordet ditt.</p>
        <p>Denne lenken utløper om 5 minutter.</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
      `,
    };
  }

  return {
    subject: "Reset your password",
    text: `Click the link below to reset your password. This link expires in 5 minutes.\n\n${resetUrl}`,
    html: `
      <h2>PunDad - Password Reset</h2>
      <p>Click the link below to reset your password.</p>
      <p>This link expires in 5 minutes.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
    `,
  };
}

function getVerificationContent(verificationUrl, language = "EN") {
  const lang = normalizeLanguage(language);
  if (lang === "NO") {
    return {
      subject: "Bekreft PunDad-kontoen din",
      text: `Klikk på lenken for å bekrefte e-postadressen din. Lenken utløper om 15 minutter.\n\n${verificationUrl}`,
      html: `
        <h2>Velkommen til PunDad</h2>
        <p>Klikk på lenken under for å bekrefte e-postadressen din.</p>
        <p>Denne lenken utløper om 15 minutter.</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      `,
    };
  }

  return {
    subject: "Verify your PunDad account",
    text: `Click the link below to verify your email address. This link expires in 15 minutes.\n\n${verificationUrl}`,
    html: `
      <h2>Welcome to PunDad</h2>
      <p>Click the link below to verify your email address.</p>
      <p>This link expires in 15 minutes.</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
    `,
  };
}

function getContactConfirmationContent({ name, topic }, language = "EN") {
  const lang = normalizeLanguage(language);

  if (lang === "NO") {
    return {
      subject: "Takk for at du kontaktet PunDad",
      text: [
        `Hei ${name},`,
        ``,
        `Takk for at du kontaktet oss. Vi har mottatt meldingen din og tar kontakt hvis vi trenger mer informasjon.`,
        ``,
        `Emne: ${topic}`,
        ``,
        `PunDad`,
      ].join("\n"),
      html: `
        <h2>Takk for at du kontaktet oss</h2>
        <p>Hei ${escapeHtml(name)},</p>
        <p>Vi har mottatt meldingen din og tar kontakt hvis vi trenger mer informasjon.</p>
        <p><strong>Emne:</strong> ${escapeHtml(topic)}</p>
      `,
    };
  }

  return {
    subject: "Thanks for contacting PunDad",
    text: [
      `Hi ${name},`,
      ``,
      `Thanks for contacting us. We received your message and will reach out if we need more information.`,
      ``,
      `Topic: ${topic}`,
      ``,
      `PunDad`,
    ].join("\n"),
    html: `
      <h2>Thanks for contacting us</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>We received your message and will reach out if we need more information.</p>
      <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
    `,
  };
}

async function sendEmail({ to, subject, html, text, replyTo = EMAIL_REPLY_TO }) {
  return resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text,
    replyTo,
  });
}

function assertEmailSent(result) {
  if (result?.error) {
    throw new Error(result.error.message || "Resend failed to send email");
  }
}

async function sendResetPasswordEmail(to, resetUrl, language = "EN") {
  const content = getResetPasswordContent(resetUrl, language);
  return sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

async function sendVerificationEmail(to, verificationUrl, language = "EN") {
  const content = getVerificationContent(verificationUrl, language);
  return sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

async function sendContactEmails({ name, email, topic, message }, { language = "EN" } = {}) {
  const adminEmail = CONTACT_TOPIC_EMAILS[topic] || CONTACT_ADMIN_EMAIL;
  const confirmationContent = getContactConfirmationContent({ name, topic }, language);
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message).replaceAll("\n", "<br>");

  const adminText = [
    `New PunDad contact message`,
    ``,
    `Name: ${name}`,
    `Email: ${email}`,
    `Topic: ${topic}`,
    ``,
    message,
  ].join("\n");

  const results = await Promise.all([
    sendEmail({
      to: adminEmail,
      subject: `[PunDad Contact] ${topic} - ${name}`,
      text: adminText,
      html: `
        <h2>New PunDad contact message</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Topic:</strong> ${safeTopic}</p>
        <p><strong>Message:</strong></p>
        <p>${safeMessage}</p>
      `,
      replyTo: email,
    }),
    sendEmail({
      to: email,
      subject: confirmationContent.subject,
      text: confirmationContent.text,
      html: confirmationContent.html,
    }),
  ]);

  results.forEach(assertEmailSent);
  return results;
}

export default {
  sendResetPasswordEmail,
  sendVerificationEmail,
  sendContactEmails,
};
