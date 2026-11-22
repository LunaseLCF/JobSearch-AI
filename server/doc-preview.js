/**
 * Document Preview Module
 * Generates well-presented, print-ready HTML previews of the CV and cover letter.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PRINT_STYLES = `
  *{box-sizing:border-box}
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;line-height:1.5;background:#e9ecef}
  .doc-page{width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:22mm 20mm;box-shadow:0 4px 20px rgba(0,0,0,.12)}
  .doc-head{display:flex;gap:18px;align-items:flex-start}
  .doc-head > div{flex:1;min-width:0}
  .doc-photo{width:86px;height:106px;object-fit:cover;border-radius:6px;border:1px solid #ccc;flex:0 0 auto}
  .doc-name{font-size:36px;font-weight:800;letter-spacing:-1px;color:#1f7a6d;margin:0}
  .doc-contact{font-size:11px;color:#555;margin-top:6px;display:flex;flex-wrap:wrap;gap:14px}
  .doc-contact a{color:#1f7a6d;text-decoration:none}
  .doc-section{margin-top:22px}
  .doc-section h2{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:#1f7a6d;border-bottom:2px solid #1f7a6d;padding-bottom:4px;margin:0 0 10px}
  .doc-entry{margin-bottom:14px;page-break-inside:avoid}
  .doc-entry-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
  .doc-entry-title{font-weight:700;font-size:13px}
  .doc-entry-org{font-size:12px;color:#444}
  .doc-entry-date{font-size:11px;color:#666;white-space:nowrap}
  .doc-entry-loc{font-size:11px;color:#777}
  .doc-bullets{margin:6px 0 0;padding-left:18px}
  .doc-bullets li{font-size:11px;margin-bottom:3px}
  .doc-tags{display:flex;flex-wrap:wrap;gap:6px}
  .doc-tag{background:#e8f5f3;color:#1f7a6d;font-size:11px;padding:3px 8px;border-radius:4px}
  .doc-letter-date{margin:26px 0 18px;font-size:12px;color:#555}
  .doc-letter-body p{font-size:12px;margin:0 0 12px;text-align:justify}
  .doc-letter-body ul{font-size:12px;padding-left:18px;margin:0 0 12px}
  .doc-sign{margin-top:28px;font-size:12px}
  .doc-sign .name{font-weight:700;font-size:14px;color:#1f7a6d}
  .doc-toolbar{max-width:210mm;margin:20px auto 0;display:flex;gap:8px;justify-content:flex-end}
  @media print{
    body{background:#fff}
    .doc-toolbar{display:none}
    .doc-page{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}
    @page{size:A4;margin:20mm}
  }
`;

function wrapPage(inner, title) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_STYLES}</style></head><body>
  <div class="doc-toolbar">
    <button onclick="window.print()" style="padding:8px 16px;background:#2A9D8F;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px">🖨️ Print / Save as PDF</button>
  </div>
  <div class="doc-page">${inner}</div>
  </body></html>`;
}

function renderCV(profile, company, role) {
  const id = profile.identity || {};
  const photoUrl = id.photoUrl || '';
  const name = id.name || '[YOUR NAME]';
  const skills = profile.skills || {};
  const experience = profile.experience || [];
  const education = profile.education || [];
  const languages = profile.languages || [];
  const highlights = profile.highlights || [];
  const matched = new Set((profile._matchedSkills || []).map(s => String(s).toLowerCase()));

  const contacts = [];
  if (id.email) contacts.push(`<a href="mailto:${esc(id.email)}">${esc(id.email)}</a>`);
  if (id.phone) contacts.push(esc(id.phone));
  if (id.location) contacts.push(esc(id.location));
  if (id.linkedin) contacts.push(`<a href="${esc(id.linkedin)}" target="_blank">LinkedIn</a>`);
  if (id.github) contacts.push(`<a href="${esc(id.github)}" target="_blank">GitHub</a>`);

  // Each entry is [skillName, categoryLabel] — keep skill first so the tag
  // shows the competency, not the internal category name.
  const allSkills = [
    ...(skills.primary || []).map(s => [s, '']),
    ...(skills.secondary || []).map(s => [s, '']),
    ...(skills.domain || []).map(s => [s, 'Domain']),
    ...(skills.software || []).map(s => [s, 'Tools']),
  ];

  const expHtml = experience.map(exp => {
    const bullets = (exp.bullets || exp.responsibilities || []);
    const dateText = (exp.start || exp.end)
      ? `${esc(exp.start || '')}${exp.start && exp.end ? ' – ' : ''}${esc(exp.end || '')}`
      : '';
    return `<div class="doc-entry">
      <div class="doc-entry-head">
        <div>
          <span class="doc-entry-title">${esc(exp.title || 'Job Title')}</span>
          ${exp.company ? `<span class="doc-entry-org"> · ${esc(exp.company)}</span>` : ''}
        </div>
        ${dateText ? `<span class="doc-entry-date">${dateText}</span>` : ''}
      </div>
      ${exp.location ? `<div class="doc-entry-loc">${esc(exp.location)}${exp.employmentType ? ' · ' + esc(exp.employmentType) : ''}</div>` : ''}
      ${bullets.length ? `<ul class="doc-bullets">${bullets.map(b => `<li>${esc(typeof b === 'string' ? b : b.text || '')}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('') || '<p style="font-size:12px;color:#888">No experience listed.</p>';

  const eduHtml = education.map(edu => `<div class="doc-entry">
    <div class="doc-entry-head">
      <div><span class="doc-entry-title">${esc(edu.degree || 'Degree')}</span>${edu.institution ? `<span class="doc-entry-org"> · ${esc(edu.institution)}</span>` : ''}</div>
      <span class="doc-entry-date">${esc(edu.start || '')}${edu.start && edu.end ? ' – ' : ''}${esc(edu.end || '')}</span>
    </div>
    ${edu.topics || edu.description ? `<div class="doc-entry-loc">${esc(edu.topics || edu.description)}</div>` : ''}
  </div>`).join('') || '<p style="font-size:12px;color:#888">No education listed.</p>';

  const inner = `
    <div class="doc-head">
      ${photoUrl ? `<img class="doc-photo" src="${esc(photoUrl)}" alt="">` : ''}
      <div>
        <h1 class="doc-name">${esc(name)}</h1>
        <div class="doc-contact">${contacts.join('<span>|</span>')}</div>
      </div>
    </div>

    <div class="doc-section">
      <h2>Profile</h2>
      <p style="font-size:12px;margin:0">${profile.summary ? esc(profile.summary) : `${role && company ? `Tailored application for the <strong>${esc(role)}</strong> position at <strong>${esc(company)}</strong>. ` : ''}${esc(profile.behavioral?.strengths?.slice(0, 3).join(', ') || 'Experienced professional with a track record of delivering results.')}`}</p>
    </div>

    ${highlights.length ? `<div class="doc-section">
      <h2>Why My Background Fits This Role</h2>
      <ul class="doc-bullets">${highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
    </div>` : ''}

    <div class="doc-section">
      <h2>Core Competencies</h2>
      <div class="doc-tags">${allSkills.map(([label, s]) => `<span class="doc-tag"${matched.has(String(s).toLowerCase()) ? ' style="background:#1f7a6d;color:#fff;font-weight:600"' : ''}>${esc(s)}${label ? ' (' + esc(label) + ')' : ''}</span>`).join('') || '<span class="doc-tag">Add skills in your profile</span>'}</div>
    </div>

    <div class="doc-section">
      <h2>Professional Experience</h2>
      ${expHtml}
    </div>

    <div class="doc-section">
      <h2>Education</h2>
      ${eduHtml}
    </div>

    <div class="doc-section">
      <h2>Languages</h2>
      <p style="font-size:12px;margin:0">${languages.map(l => `${esc(l.language)}${l.level ? ' (' + esc(l.level) + ')' : ''}`).join(' · ') || 'Not specified'}</p>
    </div>

    <div class="doc-section">
      <h2>References</h2>
      <p style="font-size:12px;margin:0">Available upon request.</p>
    </div>
  `;
  return wrapPage(inner, `CV - ${name}`);
}

function renderCoverLetter(profile, company, role) {
  const id = profile.identity || {};
  const photoUrl = id.photoUrl || '';
  const name = id.name || '[YOUR NAME]';
  const experience = profile.experience || [];
  const top = experience[0] || {};
  const skills = profile.skills || {};
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const contacts = [];
  if (id.email) contacts.push(esc(id.email));
  if (id.phone) contacts.push(esc(id.phone));
  if (id.location) contacts.push(esc(id.location));

  const highlights = (profile.highlights || []);
  const bulletsToShow = highlights.length ? highlights : ((top.bullets || top.responsibilities || []).slice(0, 1));
  const topSkills = (skills.primary || []).slice(0, 5).join(', ') || 'core skills';

  const inner = `
    <div class="doc-head">
      ${photoUrl ? `<img class="doc-photo" src="${esc(photoUrl)}" alt="">` : ''}
      <div>
        <h1 class="doc-name" style="font-size:30px">${esc(name)}</h1>
        <div class="doc-contact">${contacts.join('<span>|</span>')}</div>
      </div>
    </div>
    <div class="doc-letter-date">${today}</div>

    <div style="font-size:12px;margin-bottom:18px"><strong>Hiring Manager</strong><br>${esc(company || '[Company]')}</div>

    <div class="doc-letter-body">
      <p>Dear Hiring Manager,</p>
      <p>I am writing to express my strong interest in the <strong>${esc(role || '[Role]')}</strong> position at <strong>${esc(company || '[Company]')}</strong>. ${profile.summary ? esc(profile.summary) : `${top.title ? `With my background as a ${esc(top.title)}` : 'With my professional background'} and a proven track record of delivering results, I am confident I would be a valuable addition to your team.`}</p>
      <p>Here is how my experience maps to your requirements:</p>
      <ul>
        ${bulletsToShow.map(b => `<li><strong>Relevant Experience:</strong> ${esc(typeof b === 'string' ? b : b.text || '')}</li>`).join('')}
        <li><strong>Relevant Competencies:</strong> ${esc(topSkills)}</li>
      </ul>
      <p>I am particularly drawn to ${esc(company || 'your organization')} because this role aligns closely with the experience and strengths set out above. I would welcome the opportunity to discuss how I can contribute to your team's goals.</p>
      <p>I look forward to hearing from you.</p>
    </div>

    <div class="doc-sign">
      <div>Kind regards,</div>
      <div class="name" style="margin-top:30px">${esc(name)}</div>
    </div>
  `;
  return wrapPage(inner, `Cover Letter - ${company || 'Application'}`);
}

module.exports = { renderCV, renderCoverLetter };
