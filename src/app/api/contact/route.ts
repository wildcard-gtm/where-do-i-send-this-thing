import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { name, email, subject, message } = await request.json();

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: "All fields are required (name, email, subject, message)" },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    // Save to database
    await prisma.contactMessage.create({
      data: {
        name,
        email,
        subject,
        message,
      },
    });

    // Send email notification
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const toEmail = process.env.CONTACT_EMAIL_TO || "shane@wildcard.gtm";
      const ccEmail = process.env.CONTACT_EMAIL_CC || "sammy@wildcard.gtm";

      await transporter.sendMail({
        from: `"WDISTT Contact Form" <${process.env.SMTP_USER || "noreply@wdistt.com"}>`,
        to: toEmail,
        cc: ccEmail,
        subject: `[WDISTT Contact] ${subject}`,
        text: [
          `New contact form submission from WDISTT:`,
          ``,
          `Name: ${name}`,
          `Email: ${email}`,
          `Subject: ${subject}`,
          ``,
          `Message:`,
          `${message}`,
          ``,
          `---`,
          `This message was sent via the WDISTT contact form.`,
        ].join("\n"),
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #f8f9fc; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
              <h2 style="color: #1a1a2e; margin: 0 0 16px 0; font-size: 18px;">New Contact Form Submission</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 80px; vertical-align: top;">Name:</td>
                  <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; vertical-align: top;">Email:</td>
                  <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px;"><a href="mailto:${email}" style="color: #2563eb;">${email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; vertical-align: top;">Subject:</td>
                  <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px;">${subject}</td>
                </tr>
              </table>
            </div>
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
              <h3 style="color: #1a1a2e; margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">Message:</h3>
              <p style="color: #1a1a2e; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${message}</p>
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; text-align: center;">
              Sent via the WDISTT contact form
            </p>
          </div>
        `,
      });
    } catch (emailError) {
      // Log the email error but don't fail the request — the message is saved in the database
      console.error("Failed to send contact email notification:", emailError);
    }

    return NextResponse.json(
      { message: "Your message has been sent successfully." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 500 }
    );
  }
}
