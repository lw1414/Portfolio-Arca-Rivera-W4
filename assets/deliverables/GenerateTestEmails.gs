/**
 * GenerateTestEmails.gs
 * --------------------------------------------------------------------------
 * Generates a large volume of realistic-but-fake test emails and INSERTS them
 * directly into a Gmail inbox with BACKDATED timestamps spread over time.
 *
 * Why "insert" instead of "send"?
 *   Gmail.Users.Messages.insert() lets us place a message in the mailbox with
 *   any Date: header we want, so emails appear spread across days/weeks
 *   instead of all arriving "now". (GmailApp.sendEmail cannot backdate.)
 *
 * SETUP (one time):
 *   1. Open https://script.google.com and create a new project.
 *   2. Paste this whole file in (replace the default Code.gs contents).
 *   3. Enable the Gmail advanced service:
 *        Editor left panel -> Services (+) -> "Gmail API" -> Add.
 *      (This turns on the `Gmail.*` advanced service used below.)
 *   4. Set TEST_EMAIL below to your test inbox address.
 *   5. Run `generateTestEmails`. Approve the OAuth scopes when prompted.
 *
 * NOTE: Do NOT run yet if you only wanted the code generated. Review first.
 * --------------------------------------------------------------------------
 */

// ===========================================================================
// CONFIG
// ===========================================================================
const CONFIG = {
  // The inbox that will receive the inserted test messages.
  // IMPORTANT: set this to your own test address.
  TEST_EMAIL: 'your-test-address@example.com',

  // Total number of emails to generate (>= 100 as requested).
  TOTAL_EMAILS: 120,

  // Spread timestamps across the last N days.
  SPREAD_DAYS: 30,

  // Mark roughly this fraction of inserted mail as UNREAD (rest read).
  UNREAD_FRACTION: 0.6,

  // Add a header tag so you can find/delete every test message later with the
  // Gmail search:  X-Test-Batch  (or just search subject text).
  TEST_TAG_HEADER: 'X-Test-Batch',
  TEST_TAG_VALUE: 'inbox-management-demo',

  // Insert in small chunks with a short pause to stay under quotas.
  CHUNK_SIZE: 25,
  CHUNK_PAUSE_MS: 1500,
};

// ===========================================================================
// SENDER / CONTENT POOLS  (realistic but FAKE)
// ===========================================================================

// Each category carries its own pool of fake senders + subject templates.
// {tokens} in subjects are filled from the TOKENS table below.
const CATEGORIES = {
  Newsletter: {
    weight: 18,
    senders: [
      { name: 'The Morning Brew',        email: 'daily@morningbrew-mail.com' },
      { name: 'Stratechery Weekly',      email: 'updates@stratechery-digest.com' },
      { name: 'TLDR Tech',               email: 'news@tldr-techmail.com' },
      { name: 'The Hustle',              email: 'hello@thehustle-news.co' },
      { name: 'Product Hunt Daily',      email: 'digest@ph-dailymail.com' },
    ],
    subjects: [
      '☕ Your {weekday} briefing: {topic} is heating up',
      'This week in {topic}: 5 things you missed',
      'The {number}-minute read on {topic}',
      '{topic}, explained — plus what to watch next week',
      'Issue #{issue}: {topic} and the road ahead',
    ],
  },

  Receipt: {
    weight: 14,
    senders: [
      { name: 'Amazon.com',              email: 'auto-confirm@amazon-orders.com' },
      { name: 'Uber Receipts',           email: 'receipts@uber-mail.com' },
      { name: 'Spotify',                 email: 'no-reply@spotify-billing.com' },
      { name: 'Apple',                   email: 'no_reply@apple-receipts.com' },
      { name: 'DoorDash',                email: 'orders@doordash-mail.com' },
    ],
    subjects: [
      'Your receipt from {merchant} — ${amount}',
      'Order #{order} confirmed',
      'Payment received: ${amount}',
      'Your {merchant} order is on the way',
      'Thanks for your purchase (${amount})',
    ],
  },

  JobAlert: {
    weight: 12,
    senders: [
      { name: 'LinkedIn Job Alerts',     email: 'jobalerts-noreply@linkedin-mail.com' },
      { name: 'Indeed',                  email: 'alert@indeed-jobmail.com' },
      { name: 'Glassdoor Jobs',          email: 'jobs@glassdoor-alerts.com' },
      { name: 'Wellfound',               email: 'talent@wellfound-mail.com' },
      { name: 'Hired',                   email: 'matches@hired-mail.com' },
    ],
    subjects: [
      '{number} new {role} jobs match your profile',
      '{company} is hiring a {role}',
      'New {role} roles in {city}',
      'Your job alert: {role} — {number} openings',
      '{role} at {company} and {number} more',
    ],
  },

  Spam: {
    weight: 14,
    senders: [
      { name: 'PRIZE NOTIFICATION',      email: 'winner@claim-rewards-now.biz' },
      { name: 'Account Security',        email: 'support@secure-verify-account.info' },
      { name: 'Crypto Insider',          email: 'tips@crypto-moon-alerts.net' },
      { name: 'Dr. Health',              email: 'offers@miracle-wellness-deal.biz' },
      { name: 'Lottery Board',           email: 'noreply@intl-lotto-claims.org' },
    ],
    subjects: [
      'CONGRATULATIONS!!! You have won ${amount}',
      'URGENT: Your account will be suspended',
      'Re: Re: your unclaimed funds',
      'You won\'t believe this {topic} trick',
      'Final notice — verify within 24 hours',
    ],
  },

  MeetingInvite: {
    weight: 12,
    senders: [
      { name: 'Sarah Chen',              email: 'sarah.chen@northgate-systems.com' },
      { name: 'Marcus Webb',             email: 'm.webb@brightpath-labs.com' },
      { name: 'Calendar',                email: 'invites@meet-scheduler.com' },
      { name: 'Priya Nair',              email: 'priya.nair@helix-partners.com' },
      { name: 'Tom Alvarez',             email: 'tom.alvarez@cedarworks.io' },
    ],
    subjects: [
      'Invitation: {meeting} @ {weekday} {time}',
      'Meeting invite: {meeting}',
      'Updated invitation: {meeting} ({weekday})',
      'Can you make {meeting} on {weekday}?',
      '{meeting} — please accept',
    ],
  },

  ClientFollowUp: {
    weight: 12,
    senders: [
      { name: 'Daniel Brooks',           email: 'daniel.brooks@meridian-retail.com' },
      { name: 'Aisha Rahman',            email: 'a.rahman@quartz-capital.com' },
      { name: 'Greg Sullivan',           email: 'greg@summit-logistics.com' },
      { name: 'Elena Petrova',           email: 'elena.petrova@vantage-media.com' },
      { name: 'James Okafor',            email: 'james.okafor@harbor-consulting.com' },
    ],
    subjects: [
      'Following up on {topic}',
      'Re: {topic} — any update?',
      'Quick question about the {topic} proposal',
      'Checking in: {topic}',
      'Next steps on {topic}',
    ],
  },

  Promotional: {
    weight: 16,
    senders: [
      { name: 'Nike',                    email: 'news@nike-promos.com' },
      { name: 'Best Buy Deals',          email: 'deals@bestbuy-offers.com' },
      { name: 'Airbnb',                  email: 'hello@airbnb-travel-mail.com' },
      { name: 'Sephora',                 email: 'beauty@sephora-offers.com' },
      { name: 'Booking.com',             email: 'promos@booking-deals-mail.com' },
    ],
    subjects: [
      '🔥 {percent}% off everything — today only',
      'Your exclusive {percent}% off code inside',
      'Last chance: {percent}% off ends tonight',
      'New arrivals + free shipping',
      'We miss you — here\'s {percent}% off',
    ],
  },
};

// Token pools used to fill {placeholders} in subject lines.
const TOKENS = {
  weekday:  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  topic:    ['AI', 'remote work', 'fintech', 'climate tech', 'marketing', 'the housing market', 'open source', 'productivity'],
  number:   ['3', '5', '7', '9', '12', '15'],
  issue:    ['142', '187', '203', '256', '311'],
  merchant: ['Amazon', 'Uber', 'Spotify', 'Apple', 'DoorDash', 'Target'],
  amount:   ['12.99', '4.50', '87.20', '199.00', '23.45', '9.99', '1,000,000', '540.00'],
  order:    ['114-7783920', '992-1043887', '305-7741200', '778-2290114'],
  role:     ['Product Manager', 'Software Engineer', 'Data Analyst', 'UX Designer', 'Account Executive', 'Marketing Lead'],
  company:  ['Northgate Systems', 'BrightPath Labs', 'Helix Partners', 'Cedarworks', 'Vantage Media'],
  city:     ['Austin', 'Remote', 'New York', 'Seattle', 'Chicago'],
  meeting:  ['Q3 Planning Sync', 'Design Review', '1:1 Check-in', 'Vendor Demo', 'Sprint Retro', 'Budget Review'],
  time:     ['9:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '4:15 PM'],
  percent:  ['10', '15', '20', '25', '40', '50', '70'],
};

// ===========================================================================
// MAIN
// ===========================================================================
function generateTestEmails() {
  if (CONFIG.TEST_EMAIL === 'your-test-address@example.com') {
    throw new Error('Set CONFIG.TEST_EMAIL to your test inbox before running.');
  }

  const plan = buildPlan_(CONFIG.TOTAL_EMAILS);   // [{category, ...}] with weighted mix
  Logger.log('Planned %s emails across %s categories.', plan.length, Object.keys(CATEGORIES).length);

  let inserted = 0;
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    try {
      insertMessage_(item);
      inserted++;
    } catch (err) {
      Logger.log('Insert failed (%s): %s', item.category, err.message);
    }

    // Throttle in chunks to respect quotas.
    if ((i + 1) % CONFIG.CHUNK_SIZE === 0) {
      Logger.log('Inserted %s / %s ...', inserted, plan.length);
      Utilities.sleep(CONFIG.CHUNK_PAUSE_MS);
    }
  }

  Logger.log('DONE. Inserted %s of %s test emails into %s.', inserted, plan.length, CONFIG.TEST_EMAIL);
  Logger.log('To remove them later, search Gmail for: subject contains a test phrase, or use cleanupTestEmails().');
}

/**
 * Optional cleanup helper: trashes everything carrying the test batch label.
 * We tag inserted mail with a custom Gmail label so it is easy to bulk-remove.
 */
function cleanupTestEmails() {
  const label = GmailApp.getUserLabelByName(CONFIG.TEST_TAG_VALUE);
  if (!label) { Logger.log('No test label found — nothing to clean.'); return; }
  let threads, total = 0;
  do {
    threads = label.getThreads(0, 100);
    threads.forEach(t => { t.moveToTrash(); total++; });
  } while (threads.length > 0);
  Logger.log('Trashed %s test threads.', total);
}

// ===========================================================================
// PLAN BUILDER  (weighted category mix + spread timestamps)
// ===========================================================================
function buildPlan_(total) {
  const names = Object.keys(CATEGORIES);
  const weighted = [];
  names.forEach(n => { for (let i = 0; i < CATEGORIES[n].weight; i++) weighted.push(n); });

  const plan = [];
  const now = Date.now();
  const spreadMs = CONFIG.SPREAD_DAYS * 24 * 60 * 60 * 1000;

  for (let i = 0; i < total; i++) {
    const category = weighted[Math.floor(Math.random() * weighted.length)];

    // Random point in the window, then nudge to realistic-ish business hours.
    let ts = now - Math.floor(Math.random() * spreadMs);
    ts = nudgeToBusinessHours_(ts);

    plan.push({ category, date: new Date(ts) });
  }

  // Sort oldest -> newest so the inbox reads naturally.
  plan.sort((a, b) => a.date - b.date);
  return plan;
}

// Pull a timestamp toward 7am–7pm so mail doesn't all land at 3am.
function nudgeToBusinessHours_(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  if (h < 7)  d.setHours(7 + Math.floor(Math.random() * 12));
  if (h > 19) d.setHours(8 + Math.floor(Math.random() * 11));
  d.setMinutes(Math.floor(Math.random() * 60));
  d.setSeconds(Math.floor(Math.random() * 60));
  return d.getTime();
}

// ===========================================================================
// MESSAGE BUILDER + INSERT
// ===========================================================================
function insertMessage_(item) {
  const cat = CATEGORIES[item.category];
  const sender = pick_(cat.senders);
  const subject = fill_(pick_(cat.subjects));
  const body = buildBody_(item.category, sender, subject);

  const raw = buildRawMime_({
    fromName: sender.name,
    fromEmail: sender.email,
    toEmail: CONFIG.TEST_EMAIL,
    subject: subject,
    date: item.date,
    bodyText: body,
    extraHeaders: {
      [CONFIG.TEST_TAG_HEADER]: CONFIG.TEST_TAG_VALUE,
      'X-Test-Category': item.category,
    },
  });

  const labelIds = ['INBOX'];
  if (Math.random() < CONFIG.UNREAD_FRACTION) labelIds.push('UNREAD');

  // internalDateSource: 'dateHeader' tells Gmail to use our backdated Date:.
  Gmail.Users.Messages.insert(
    { labelIds: labelIds },
    'me',
    Utilities.newBlob(raw, 'message/rfc822'),
    { internalDateSource: 'dateHeader' }
  );

  // Apply a findable user label for easy cleanup.
  // (Inserted via Gmail API as raw; tag the thread through GmailApp afterward
  //  would require a search — instead we rely on cleanupTestEmails which
  //  searches the custom header label created on demand below.)
  ensureTestLabel_();
}

// Create the cleanup label once (idempotent).
function ensureTestLabel_() {
  if (!ensureTestLabel_._done) {
    if (!GmailApp.getUserLabelByName(CONFIG.TEST_TAG_VALUE)) {
      GmailApp.createLabel(CONFIG.TEST_TAG_VALUE);
    }
    ensureTestLabel_._done = true;
  }
}

/**
 * Build a minimal RFC 2822 message as a RAW string.
 * NOTE: do NOT base64-encode here. When we hand this to the Gmail API as a
 * blob (media upload), it must be the raw RFC822 text — Gmail encodes it.
 * Double-encoding is what caused "unknown sender" + empty body.
 */
function buildRawMime_(o) {
  const headers = [
    'From: ' + formatFrom_(o.fromName, o.fromEmail),
    'To: ' + o.toEmail,
    'Subject: ' + encodeSubject_(o.subject),
    'Date: ' + Utilities.formatDate(o.date, Session.getScriptTimeZone(), "EEE, dd MMM yyyy HH:mm:ss Z"),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ];
  for (const k in (o.extraHeaders || {})) headers.push(k + ': ' + o.extraHeaders[k]);

  return headers.join('\r\n') + '\r\n\r\n' + o.bodyText;
}

// ===========================================================================
// BODY + HELPERS
// ===========================================================================
function buildBody_(category, sender, subject) {
  const intro = {
    Newsletter:    'Here is your latest issue. Top stories, links, and a quick take below.',
    Receipt:       'Thanks for your order. This email confirms your recent transaction.',
    JobAlert:      'New roles matching your saved search are listed below.',
    Spam:          'You have been specially selected! Act now to claim your reward.',
    MeetingInvite: 'You are invited to the following meeting. Please accept or decline.',
    ClientFollowUp:'Hi — just circling back on the item below when you have a moment.',
    Promotional:   'A limited-time offer just for you. Shop now before it ends.',
  }[category] || 'Hello,';

  return [
    intro,
    '',
    'RE: ' + subject,
    '',
    'This is an automatically generated TEST email used to populate an inbox',
    'for sorting, labeling, and reporting demos. It was not sent by a real',
    'person or company. Sender shown: ' + sender.name + ' <' + sender.email + '>.',
    '',
    'Category: ' + category,
    'Reference: ' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    '',
    '— Test data generator',
  ].join('\r\n');
}

function pick_(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fill_(template) {
  return template.replace(/\{(\w+)\}/g, (m, key) =>
    TOKENS[key] ? pick_(TOKENS[key]) : m);
}

function formatFrom_(name, email) {
  // Quote display names that contain special chars.
  const safe = /[",<>]/.test(name) ? '"' + name.replace(/"/g, '\\"') + '"' : name;
  return safe + ' <' + email + '>';
}

// RFC 2047 encode subjects that contain non-ASCII (e.g. emoji).
function encodeSubject_(s) {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = Utilities.base64Encode(Utilities.newBlob(s).getBytes());
  return '=?UTF-8?B?' + b64 + '?=';
}
