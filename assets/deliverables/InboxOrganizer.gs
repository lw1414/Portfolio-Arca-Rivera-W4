/**
 * InboxOrganizer.gs  —  AI-generated Gmail inbox organizer (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Three entry points:
 *   1. analyzeInbox()   — READ-ONLY. Scans inbox, reports categories/senders.
 *   2. organizeInbox()  — Creates AutoSort/* labels, applies them, emails a report.
 *   3. resetAutoSort()  — Removes every AutoSort label (full reset / re-run).
 *
 * SETUP:
 *   1. script.google.com -> new project -> paste this in.
 *   2. (No advanced services needed — uses the built-in GmailApp service.)
 *   3. Run analyzeInbox() first (safe, changes nothing). Approve scopes.
 *   4. Review the log, then run organizeInbox().
 *   5. resetAutoSort() if you want to start over.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// CONFIG
// ===========================================================================
const ORG = {
  PARENT: 'AutoSort',          // parent label namespace -> AutoSort/<Category>
  MAX_THREADS: 300,            // cap for performance (Gmail quota-friendly)
  PAGE_SIZE: 100,              // threads fetched per page
  REPORT_TO: '',               // '' = send the report to yourself (active user)
  APPLY_TO_QUERY: 'in:inbox',  // which mail to organize
};

// Canonical category list -> becomes AutoSort/<name> sub-labels.
const CATEGORIES = [
  'Clients & Follow-ups',
  'Meetings & Calendar',
  'Receipts & Payments',
  'Shipping & Delivery',
  'Jobs & Careers',
  'Newsletters',
  'Promotions & Offers',
  'Social Notifications',
  'Spam & Junk',
  'Uncategorized',
];

// ===========================================================================
// STEP 1 — ANALYSIS (READ-ONLY)
// ===========================================================================
/**
 * Scans the inbox and prints a report. Makes NO changes to your mailbox.
 */
function analyzeInbox() {
  const threads = fetchThreads_(ORG.APPLY_TO_QUERY, ORG.MAX_THREADS);
  const stats = blankStats_();

  threads.forEach(thread => {
    const msg = thread.getMessages()[0];               // classify on first msg
    const info = extractInfo_(msg);
    const category = classify_(info);

    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.bySenderDomain[info.domain] = (stats.bySenderDomain[info.domain] || 0) + 1;
    stats.total++;
    if (thread.isUnread()) stats.unread++;
  });

  printReport_('READ-ONLY ANALYSIS', stats, threads.length);
  return stats;   // also returned for programmatic use
}

// ===========================================================================
// STEP 2 — ORGANIZE (creates labels, applies them, emails report)
// ===========================================================================
function organizeInbox() {
  // 1. Ensure the full AutoSort/* label tree exists.
  const labels = ensureLabels_();

  // 2. Scan + classify + apply.
  const threads = fetchThreads_(ORG.APPLY_TO_QUERY, ORG.MAX_THREADS);
  const stats = blankStats_();
  const examples = {};   // category -> a few example subjects

  threads.forEach(thread => {
    const msg = thread.getMessages()[0];
    const info = extractInfo_(msg);
    const category = classify_(info);

    labels[category].addToThread(thread);              // <-- applies the label

    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.bySenderDomain[info.domain] = (stats.bySenderDomain[info.domain] || 0) + 1;
    stats.total++;
    if (thread.isUnread()) stats.unread++;

    (examples[category] = examples[category] || []);
    if (examples[category].length < 3) examples[category].push(info.subject);
  });

  printReport_('ORGANIZE RUN', stats, threads.length);

  // 3. Email a summary report.
  sendReportEmail_(stats, examples, threads.length);

  Logger.log('Done. Check the Gmail sidebar for the %s/ label tree.', ORG.PARENT);
  return stats;
}

// ===========================================================================
// STEP 3 — RESET (optional)
// ===========================================================================
/**
 * Removes labels from threads and deletes every AutoSort/* label so you can
 * re-run cleanly. Does NOT delete any email.
 */
function resetAutoSort() {
  const all = GmailApp.getUserLabels();
  let removed = 0;
  all.forEach(label => {
    const name = label.getName();
    if (name === ORG.PARENT || name.indexOf(ORG.PARENT + '/') === 0) {
      // Detach from all threads first (in pages), then delete the label.
      let threads;
      do {
        threads = label.getThreads(0, 100);
        threads.forEach(t => label.removeFromThread(t));
      } while (threads.length > 0);
      GmailApp.deleteLabel(label);
      removed++;
    }
  });
  Logger.log('Reset complete. Removed %s AutoSort label(s).', removed);
}

// ===========================================================================
// CLASSIFIER  (heuristic rules over sender + subject + snippet)
// ===========================================================================
/**
 * Returns one of CATEGORIES. Rules are ordered: highest-confidence /
 * most-specific signals are checked first; falls back to Uncategorized.
 */
function classify_(info) {
  const from = info.from.toLowerCase();
  const domain = info.domain.toLowerCase();
  const subj = info.subject.toLowerCase();
  const text = (subj + ' ' + info.snippet).toLowerCase();
  const has = (s, arr) => arr.some(k => s.indexOf(k) !== -1);

  // --- Spam & Junk (check early; strong scam signals) ---
  if (has(text, ['you won', 'winner', 'congratulations!!!', 'claim your', 'unclaimed funds',
                 'act now', 'risk-free', 'verify within 24', 'suspended', 'miracle',
                 'crypto', 'lottery', 'wire transfer', 'prince', 'viagra']) ||
      has(domain, ['.biz', '.info', '.top', 'claim-', 'rewards-now', 'secure-verify'])) {
    return 'Spam & Junk';
  }

  // --- Receipts & Payments ---
  if (has(subj, ['receipt', 'invoice', 'payment received', 'order confirmed', 'order #',
                 'your order', 'transaction', 'paid', 'billing', 'subscription renew']) ||
      has(from, ['receipt', 'billing', 'invoice', 'no-reply@', 'payments@'])
        && has(text, ['$', 'order', 'charged', 'total'])) {
    return 'Receipts & Payments';
  }

  // --- Shipping & Delivery ---
  if (has(text, ['shipped', 'out for delivery', 'tracking number', 'on its way',
                 'delivered', 'package', 'arriving', 'fedex', 'ups', 'usps', 'dhl'])) {
    return 'Shipping & Delivery';
  }

  // --- Meetings & Calendar ---
  if (has(subj, ['invitation:', 'meeting', 'invite', 'calendar', 'accepted:', 'declined:',
                 'reschedul', 'zoom', 'google meet', 'webex', 'rsvp', 'agenda']) ||
      has(from, ['calendar', 'invites@', 'scheduler'])) {
    return 'Meetings & Calendar';
  }

  // --- Jobs & Careers ---
  if (has(text, ['job', 'hiring', 'role', 'opening', 'apply', 'recruit', 'career',
                 'position', 'opportunity at']) ||
      has(domain, ['linkedin', 'indeed', 'glassdoor', 'wellfound', 'hired', 'ziprecruiter'])) {
    return 'Jobs & Careers';
  }

  // --- Social Notifications ---
  if (has(domain, ['facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'tiktok',
                   'reddit', 'pinterest', 'youtube', 'snapchat', 'threads']) ||
      has(text, ['tagged you', 'mentioned you', 'new follower', 'liked your',
                 'commented on', 'friend request', 'connection request'])) {
    return 'Social Notifications';
  }

  // --- Promotions & Offers ---
  if (has(text, ['% off', 'sale', 'deal', 'discount', 'coupon', 'promo', 'limited time',
                 'save now', 'shop now', 'free shipping', 'exclusive offer', 'clearance',
                 'today only', 'last chance']) ||
      has(from, ['deals@', 'offers@', 'promos@', 'marketing@'])) {
    return 'Promotions & Offers';
  }

  // --- Newsletters ---
  if (has(text, ['newsletter', 'this week', 'weekly digest', 'daily brief', 'issue #',
                 'unsubscribe', 'read more', 'in this edition']) ||
      has(from, ['newsletter', 'digest', 'news@', 'updates@', 'hello@'])) {
    return 'Newsletters';
  }

  // --- Clients & Follow-ups (personal/business correspondence) ---
  // Heuristic: a named human sender, conversational subject, low marketing signal.
  if (looksPersonal_(info) ||
      has(subj, ['re:', 'fwd:', 'following up', 'follow up', 'checking in',
                 'next steps', 'proposal', 'quick question', 'circling back'])) {
    return 'Clients & Follow-ups';
  }

  return 'Uncategorized';
}

// A sender "looks personal" if the display name has two name-like words and the
// address is not an obvious no-reply/marketing alias.
function looksPersonal_(info) {
  const name = (info.name || '').trim();
  const local = (info.from.split('@')[0] || '').toLowerCase();
  const noreply = ['no-reply', 'noreply', 'donotreply', 'mailer', 'notifications',
                   'support', 'team', 'hello', 'info', 'news', 'deals', 'offers'];
  if (noreply.some(n => local.indexOf(n) !== -1)) return false;
  return /^[A-Za-z'.-]+\s+[A-Za-z'.-]+/.test(name);
}

// ===========================================================================
// HELPERS — fetching, info extraction, labels, stats, reporting
// ===========================================================================
function fetchThreads_(query, cap) {
  const out = [];
  let start = 0;
  while (out.length < cap) {
    const page = GmailApp.search(query, start, Math.min(ORG.PAGE_SIZE, cap - out.length));
    if (!page.length) break;
    page.forEach(t => out.push(t));
    start += page.length;
    if (page.length < ORG.PAGE_SIZE) break;
  }
  return out.slice(0, cap);
}

function extractInfo_(msg) {
  const from = msg.getFrom() || '';
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const name = m ? m[1].trim() : '';
  const addr = m ? m[2].trim() : from.trim();
  const domain = (addr.split('@')[1] || 'unknown').toLowerCase();
  let snippet = '';
  try { snippet = msg.getPlainBody().slice(0, 240); } catch (e) {}
  return {
    from: addr,
    name: name,
    domain: domain,
    subject: msg.getSubject() || '(no subject)',
    snippet: snippet,
    date: msg.getDate(),
  };
}

// Create AutoSort + all sub-labels; return { 'Category': Label } map.
function ensureLabels_() {
  getOrCreate_(ORG.PARENT);   // parent namespace
  const map = {};
  CATEGORIES.forEach(cat => {
    map[cat] = getOrCreate_(ORG.PARENT + '/' + sanitize_(cat));
  });
  return map;
}

function getOrCreate_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// Gmail label names can't contain some characters; keep it readable.
function sanitize_(s) {
  return s.replace(/[\/\\]/g, '-');   // '&' and spaces are allowed in labels
}

function blankStats_() {
  return { total: 0, unread: 0, byCategory: {}, bySenderDomain: {} };
}

function printReport_(title, stats, scanned) {
  Logger.log('================ %s ================', title);
  Logger.log('Scanned threads: %s   (unread: %s)', scanned, stats.unread);

  Logger.log('--- Category breakdown ---');
  sortedEntries_(stats.byCategory).forEach(([k, v]) =>
    Logger.log('  %s  —  %s (%s%%)', pad_(k, 24), v, pct_(v, stats.total)));

  Logger.log('--- Top sender domains ---');
  sortedEntries_(stats.bySenderDomain).slice(0, 12).forEach(([k, v]) =>
    Logger.log('  %s  —  %s', pad_(k, 30), v));

  Logger.log('--- Distribution summary ---');
  Logger.log('  Total: %s | Categories used: %s | Unique domains: %s',
    stats.total, Object.keys(stats.byCategory).length, Object.keys(stats.bySenderDomain).length);
}

function sendReportEmail_(stats, examples, scanned) {
  const to = ORG.REPORT_TO || Session.getActiveUser().getEmail();
  const subject = 'AutoSort report — ' + stats.total + ' emails organized';

  let html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">';
  html += '<h2 style="margin:0 0 4px">AutoSort &mdash; Inbox Organized</h2>';
  html += '<p style="color:#555;margin:0 0 16px">Scanned <b>' + scanned +
          '</b> inbox threads (' + stats.unread + ' unread). Labels applied under <code>' +
          ORG.PARENT + '/</code>.</p>';

  // Category table
  html += '<table style="border-collapse:collapse;width:100%;font-size:14px">';
  html += '<tr style="background:#f2f4f7"><th style="text-align:left;padding:8px">Category</th>' +
          '<th style="text-align:right;padding:8px">Count</th>' +
          '<th style="text-align:right;padding:8px">Share</th></tr>';
  sortedEntries_(stats.byCategory).forEach(([k, v]) => {
    html += '<tr style="border-top:1px solid #eee">' +
            '<td style="padding:8px">' + esc_(k) + '</td>' +
            '<td style="padding:8px;text-align:right">' + v + '</td>' +
            '<td style="padding:8px;text-align:right">' + pct_(v, stats.total) + '%</td></tr>';
  });
  html += '</table>';

  // Top domains
  html += '<h3 style="margin:20px 0 6px">Top sender domains</h3><ul style="font-size:14px;color:#333">';
  sortedEntries_(stats.bySenderDomain).slice(0, 10).forEach(([k, v]) =>
    html += '<li>' + esc_(k) + ' — ' + v + '</li>');
  html += '</ul>';

  // Examples per category
  html += '<h3 style="margin:20px 0 6px">Example subjects</h3>';
  Object.keys(examples).forEach(cat => {
    html += '<p style="margin:8px 0 2px;font-weight:bold;font-size:14px">' + esc_(cat) + '</p><ul style="margin:0 0 8px;font-size:13px;color:#555">';
    examples[cat].forEach(s => html += '<li>' + esc_(s) + '</li>');
    html += '</ul>';
  });

  html += '<p style="color:#888;font-size:12px;margin-top:24px">Generated by InboxOrganizer.gs · ' +
          new Date().toLocaleString() + '</p></div>';

  GmailApp.sendEmail(to, subject, 'See the HTML version of this AutoSort report.', { htmlBody: html });
  Logger.log('Summary report emailed to %s', to);
}

// --- tiny utils ---
function sortedEntries_(obj) { return Object.keys(obj).map(k => [k, obj[k]]).sort((a, b) => b[1] - a[1]); }
function pct_(n, total) { return total ? Math.round((n / total) * 100) : 0; }
function pad_(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function esc_(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }


// ===========================================================================
// PHASE 3 — AI-STYLE REPORT (Word doc in Drive + Gmail draft)
// ===========================================================================
/**
 * generateReport()
 *   - Re-scans the inbox and classifies it (read-only; no labels changed here).
 *   - Computes category breakdown, importance distribution, and top senders.
 *   - Builds a professional report as a Google Doc, then exports a .docx copy
 *     to your Drive (downloadable, Word format).
 *   - Creates a Gmail DRAFT summarizing the report with the .docx attached.
 *
 * Review the draft in Gmail, then hit Send (or run sendReportDraft() to send
 * the most recent AutoSort draft automatically).
 *
 * Run organizeInbox() first if you want the "Label system created" section to
 * reflect labels that actually exist.
 */
function generateReport() {
  const threads = fetchThreads_(ORG.APPLY_TO_QUERY, ORG.MAX_THREADS);
  const stats = blankStats_();
  const importance = { High: 0, Medium: 0, Low: 0 };
  const senders = {};      // "Name <addr>" -> count
  const examples = {};     // category -> sample subjects

  threads.forEach(thread => {
    const msg = thread.getMessages()[0];
    const info = extractInfo_(msg);
    const category = classify_(info);

    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.bySenderDomain[info.domain] = (stats.bySenderDomain[info.domain] || 0) + 1;
    stats.total++;
    if (thread.isUnread()) stats.unread++;

    importance[importanceOf_(category)]++;

    const key = (info.name ? info.name + ' ' : '') + '<' + info.from + '>';
    senders[key] = (senders[key] || 0) + 1;

    (examples[category] = examples[category] || []);
    if (examples[category].length < 3) examples[category].push(info.subject);
  });

  const recs = buildRecommendations_(stats, importance);

  // Build Google Doc, export .docx to Drive.
  const doc = buildReportDoc_(stats, importance, senders, examples, recs, threads.length);
  const docxFile = exportAsDocx_(doc.getId(), doc.getName());

  // Create the Gmail summary draft with the Word doc attached.
  const draft = createSummaryDraft_(stats, importance, senders, recs, threads.length, docxFile);

  Logger.log('================ PHASE 3 REPORT ================');
  Logger.log('Google Doc : %s', doc.getUrl());
  Logger.log('Word (.docx): %s', docxFile.getUrl());
  Logger.log('Gmail draft : created (subject "%s"). Review, then Send.', draft.getMessage().getSubject());
  return { docUrl: doc.getUrl(), docxUrl: docxFile.getUrl() };
}

/** Optional: send the most recent AutoSort report draft via your Gmail. */
function sendReportDraft() {
  const drafts = GmailApp.getDrafts();
  for (let i = drafts.length - 1; i >= 0; i--) {
    if (drafts[i].getMessage().getSubject().indexOf('AutoSort Inbox Report') === 0) {
      drafts[i].send();
      Logger.log('Sent report draft to recipient.');
      return;
    }
  }
  Logger.log('No AutoSort report draft found — run generateReport() first.');
}

// Importance heuristic: map each category to High / Medium / Low.
function importanceOf_(category) {
  const high = ['Clients & Follow-ups', 'Meetings & Calendar', 'Jobs & Careers'];
  const low  = ['Promotions & Offers', 'Social Notifications', 'Spam & Junk', 'Uncategorized'];
  if (high.indexOf(category) !== -1) return 'High';
  if (low.indexOf(category) !== -1) return 'Low';
  return 'Medium';   // Receipts, Shipping, Newsletters
}

// Templated, data-driven recommendations (no external AI required).
function buildRecommendations_(stats, importance) {
  const recs = [];
  const c = stats.byCategory;
  const p = (cat) => pct_(c[cat] || 0, stats.total);

  if (p('Promotions & Offers') >= 20)
    recs.push('Promotions make up ' + p('Promotions & Offers') + '% of your inbox. Create a Gmail filter to auto-archive AutoSort/Promotions & Offers so they skip the inbox.');
  if ((c['Spam & Junk'] || 0) > 0)
    recs.push((c['Spam & Junk']) + ' message(s) classified as Spam & Junk. Review them and block repeat senders, or report as spam.');
  if (p('Newsletters') >= 15)
    recs.push('Newsletters are ' + p('Newsletters') + '% of volume. Consider unsubscribing from low-value lists or routing them to a "Read later" filter.');
  if ((c['Clients & Follow-ups'] || 0) > 0)
    recs.push('You have ' + c['Clients & Follow-ups'] + ' client/follow-up thread(s) — the highest-priority bucket. Triage these first each morning.');
  if (importance.High > 0)
    recs.push('High-importance mail is ' + pct_(importance.High, stats.total) + '% of the inbox. A saved search on AutoSort high-priority labels gives you a focused daily view.');
  if (stats.unread > stats.total * 0.5)
    recs.push('Over half of scanned threads are unread (' + stats.unread + '). Batch-process by label to clear the backlog faster.');
  if (!recs.length)
    recs.push('Your inbox is well balanced — keep using the AutoSort labels to maintain triage hygiene.');
  return recs;
}

// ---- Document builder (Google Doc) ----
function buildReportDoc_(stats, importance, senders, examples, recs, scanned) {
  const name = 'AutoSort Inbox Report — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const doc = DocumentApp.create(name);
  const body = doc.getBody();

  // Title
  const title = body.appendParagraph('AutoSort — Inbox Organization Report');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy 'at' h:mm a"))
      .setForegroundColor('#666666');

  // Executive summary
  body.appendParagraph('Executive Summary').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const topCat = sortedEntries_(stats.byCategory)[0] || ['Uncategorized', 0];
  body.appendParagraph(
    'This report summarizes an automated scan of ' + scanned + ' inbox threads (' + stats.unread +
    ' unread). Email was classified into ' + Object.keys(stats.byCategory).length +
    ' categories and labeled under the AutoSort/ namespace. The largest category is "' + topCat[0] +
    '" at ' + pct_(topCat[1], stats.total) + '% of volume. By importance, ' +
    pct_(importance.High, stats.total) + '% is high priority, ' +
    pct_(importance.Medium, stats.total) + '% medium, and ' +
    pct_(importance.Low, stats.total) + '% low. Detailed breakdowns and recommendations follow.');

  // Category breakdown table
  body.appendParagraph('Category Breakdown').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const catRows = [['Category', 'Count', 'Percentage']];
  sortedEntries_(stats.byCategory).forEach(([k, v]) => catRows.push([k, String(v), pct_(v, stats.total) + '%']));
  catRows.push(['Total', String(stats.total), '100%']);
  styleTable_(body.appendTable(catRows));

  // Importance distribution
  body.appendParagraph('Importance Distribution').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const impRows = [['Importance', 'Count', 'Percentage']];
  ['High', 'Medium', 'Low'].forEach(k => impRows.push([k, String(importance[k]), pct_(importance[k], stats.total) + '%']));
  styleTable_(body.appendTable(impRows));

  // Top senders
  body.appendParagraph('Top Senders').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const sndRows = [['Sender', 'Emails']];
  sortedEntries_(senders).slice(0, 12).forEach(([k, v]) => sndRows.push([k, String(v)]));
  styleTable_(body.appendTable(sndRows));

  // Label system created
  body.appendParagraph('Label System Created').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('The following label tree was created under the AutoSort parent:');
  CATEGORIES.forEach(cat => body.appendListItem(ORG.PARENT + '/' + cat).setGlyphType(DocumentApp.GlyphType.BULLET));

  // Recommendations
  body.appendParagraph('Actionable Recommendations').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  recs.forEach(r => body.appendListItem(r).setGlyphType(DocumentApp.GlyphType.NUMBER));

  doc.saveAndClose();
  return DriveApp.getFileById(doc.getId());   // wrap as a Drive file
}

function styleTable_(table) {
  // Bold the header row.
  const header = table.getRow(0);
  for (let i = 0; i < header.getNumCells(); i++) {
    header.getCell(i).editAsText().setBold(true);
  }
}

// ---- Export a Google Doc as .docx into Drive (Word format, downloadable) ----
function exportAsDocx_(docId, name) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + docId +
              '/export?mimeType=' +
              encodeURIComponent('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const blob = resp.getBlob().setName(name + '.docx');
  return DriveApp.createFile(blob);   // saved to your Drive root
}

// ---- Gmail summary draft (HTML body + .docx attachment) ----
function createSummaryDraft_(stats, importance, senders, recs, scanned, docxFile) {
  const to = ORG.REPORT_TO || Session.getActiveUser().getEmail();
  const subject = 'AutoSort Inbox Report — ' + stats.total + ' emails (' +
                  Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d') + ')';

  let html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#222">';
  html += '<h2 style="margin:0 0 4px">AutoSort Inbox Report</h2>';
  html += '<p style="color:#555;margin:0 0 16px">Automated scan of <b>' + scanned +
          '</b> threads (' + stats.unread + ' unread). Full report attached as a Word document.</p>';

  html += '<h3 style="margin:18px 0 6px">Category breakdown</h3>';
  html += '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
          '<tr style="background:#f2f4f7"><th style="text-align:left;padding:6px">Category</th>' +
          '<th style="text-align:right;padding:6px">Count</th><th style="text-align:right;padding:6px">%</th></tr>';
  sortedEntries_(stats.byCategory).forEach(([k, v]) =>
    html += '<tr style="border-top:1px solid #eee"><td style="padding:6px">' + esc_(k) +
            '</td><td style="padding:6px;text-align:right">' + v +
            '</td><td style="padding:6px;text-align:right">' + pct_(v, stats.total) + '%</td></tr>');
  html += '</table>';

  html += '<h3 style="margin:18px 0 6px">Importance</h3><p style="font-size:14px">' +
          'High ' + pct_(importance.High, stats.total) + '% · Medium ' + pct_(importance.Medium, stats.total) +
          '% · Low ' + pct_(importance.Low, stats.total) + '%</p>';

  html += '<h3 style="margin:18px 0 6px">Top senders</h3><ul style="font-size:14px">';
  sortedEntries_(senders).slice(0, 6).forEach(([k, v]) => html += '<li>' + esc_(k) + ' — ' + v + '</li>');
  html += '</ul>';

  html += '<h3 style="margin:18px 0 6px">Recommendations</h3><ol style="font-size:14px">';
  recs.forEach(r => html += '<li style="margin-bottom:4px">' + esc_(r) + '</li>');
  html += '</ol>';

  html += '<p style="color:#888;font-size:12px;margin-top:22px">Generated by InboxOrganizer.gs · ' +
          new Date().toLocaleString() + '</p></div>';

  return GmailApp.createDraft(to, subject, 'See the HTML report (attachment included).', {
    htmlBody: html,
    attachments: [docxFile.getBlob()],
  });
}
