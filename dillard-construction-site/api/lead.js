// First-party lead handler — runs as a Vercel serverless function on
// dillardconstructiongroup.com. No third-party form service: submissions are
// emailed straight to Brian & Nate via DCG's own Google Workspace SMTP.
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   SMTP_USER  = brian@dillardconstructiongroup.com
//   SMTP_PASS  = a Google "App Password" for that account (needs 2-Step
//                Verification on; create at myaccount.google.com/apppasswords)
// Optional:
//   SMTP_HOST  = smtp host (default smtp.gmail.com)
//   LEAD_TO    = comma-separated recipients
//                (default brian@ + nate@dillardconstructiongroup.com)

const nodemailer = require('nodemailer');

const FIELD_LABELS = {
  name: 'Name',
  company: 'Company',
  phone: 'Phone',
  email: 'Email',
  contact_type: 'They are a',
  service: 'Service needed',
  location: 'Project location',
  timeline: 'Timeline',
  details: 'Details',
  project: 'Project name & location',
  bid_date: 'Bid due date',
  plans_link: 'Plans / ITB link',
  scope: 'Scope needed',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  const b = req.body || {};

  // Honeypot: real users never see or fill this field. Pretend success to bots.
  if (b.website) {
    res.statusCode = 303;
    res.setHeader('Location', '/thanks');
    return res.end();
  }

  if (!b.name || (!b.phone && !b.email)) {
    res.statusCode = 400;
    return res.end('Please include your name and a phone number or email.');
  }

  const isBid = b.form_type === 'bid-invite';
  const type = isBid ? 'Bid invitation' : 'Estimate request';
  const where = b.location || b.project || '';

  const lines = Object.entries(FIELD_LABELS)
    .filter(([key]) => b[key])
    .map(([key, label]) => `${label}: ${String(b[key]).slice(0, 2000)}`)
    .join('\n');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: `"DCG Website" <${process.env.SMTP_USER}>`,
      to: process.env.LEAD_TO || 'brian@dillardconstructiongroup.com, nate@dillardconstructiongroup.com',
      replyTo: b.email || undefined,
      subject: `${type} — ${b.name}${where ? ' — ' + where : ''}`,
      text: `${type} from dillardconstructiongroup.com\n\n${lines}\n`,
    });
  } catch (err) {
    console.error('lead mail failed:', err && err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(
      '<p style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">' +
      'Sorry — the form hit a snag on our end. Please call Brian at ' +
      '<a href="tel:+18649152351">(864) 915-2351</a> or email ' +
      '<a href="mailto:brian@dillardconstructiongroup.com">brian@dillardconstructiongroup.com</a>.</p>'
    );
  }

  res.statusCode = 303;
  res.setHeader('Location', '/thanks');
  res.end();
};
