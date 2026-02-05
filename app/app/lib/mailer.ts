import nodemailer from "nodemailer";

export async function sendOtpEmail(to: string, code: string) {
  const useAuth = !!process.env.SMTP_USER; // only add auth if provided

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    ...(useAuth ? { auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! } } : {}),
  });

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@example.test";
  await transporter.sendMail({
    from, to,
    subject: "Your AxEin activation code",
    text: `Your AxEin activation code: ${code}`,
    html: `<p>Your AxEin activation code: <b>${code}</b></p>`,
  });
}
