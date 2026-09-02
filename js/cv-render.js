/* ============================================================
   CAS CV Builder — js/cv-render.js
   Shared classic script (same load pattern as parser.js — see
   CLAUDE.md on why these stay classic scripts instead of ES
   modules). Loaded by BOTH editor.html and dashboard.html, before
   editor.js / dashboard.js respectively.

   Holds the CV-rendering logic (buildCVHTML and everything it
   transitively calls) that used to live only in editor.js.
   dashboard.js's own downloadCV() used to maintain a completely
   separate, hand-written copy of this same logic for gallery
   downloads, which drifted out of sync with editor.js's version
   repeatedly over time: missing profile photos, missing footers/
   page numbers, missing section icons, several style pickers
   (Date Style, Subtitle Style, Location Style, Icon Style, Link
   Style, six "accent color" toggles) and content-logic toggles
   (Show Duration, Subtitle Same Line, Title/Subtitle Order) all
   silently had no effect on PDFs downloaded from the dashboard
   gallery, even though the exact same settings worked correctly
   from the editor's own Download button. Sharing this file instead
   of maintaining two copies is the actual fix for that whole class
   of bug, not another one-off patch.

   cvData/cvSettings stay bare global variables (declared with `var`,
   which safely tolerates being declared more than once on the same
   page — unlike `let`/`const`, which would throw a SyntaxError):
   editor.js's own `var cvData`/`var cvSettings` declarations (its
   real, continuously-edited state) simply reassign the same
   variables these functions already read; dashboard.js has no such
   declarations of its own, so this file is what actually creates
   them there, and downloadCV() assigns a Firestore-loaded CV's data
   into them for the duration of building one export payload.
   ============================================================ */

var cvData = null;
var cvSettings = null;

// Templates whose header IS a permanent colored side panel (see main.css
// "Shared sidebar base") rather than a plain top banner — buildCVHTML
// and the real-pagination path both need to know this to route the
// header/sidebar sections into that panel instead of a separate column.
const SIDEBAR_TEMPLATES = ['atlantic-blue', 'corporate-panel', 'cobalt-edge', 'obsidian-edge', 'neutral-gray'];

// Single source of truth for every Customize panel setting's default
// value. Both editor.js (var cvSettings = Object.assign({}, DEFAULTS),
// then merged with cvData.settings once a CV loads) and dashboard.js
// (merged with a Firestore CV's settings before calling buildCVHTML)
// use this same object, so a new setting added here is never missing
// from one side or the other.
const DEFAULTS = {
  template:'classic', columns:1, twoColWidth:32, sidebarPosition:'left', sidebarBgEnabled:false,
  headerAlign:'left', headerPosition:'top',
  subtitleLine:'next', paperFormat:'A4', bodyFont:'Calibri, Arial, sans-serif',
  nameFont:'inherit', baseFontSize:11, nameFontSize:19, titleFontSize:12,
  headingFontSize:10, entryFontSize:11, lineHeight:1.55, letterSpacing:0,
  sectionSpacing:11, marginLR:13, marginTB:11, headingStyle:'line',
  headingCase:'upper', subtitleStyle:'normal', dateStyle:'normal', locationStyle:'normal', listStyle:'bullet',
  dateFormat:'Month YYYY', showDuration:false, skillStyle:'text', showSectionIcons:false,
  accentColor:'#1a1a1a', colorBg:'#ffffff',
  colorSidebarBg:'#f0f4f8', colorText:'#1a1a1a', accentName:false,
  accentTitle:false, accentHeadings:true, accentLine:true, accentDates:false,
  accentSubtitle:false, showPageNums:false, linkStyle:'underline',
  footerCustom:false, footerLeft:'', footerCenter:'', footerRight:'',
  iconStyle:'none', accentIcons:false, accentLinkIcons:false,
  workTitleOrder:'normal', eduTitleOrder:'normal', summaryInHeader:false,
  photoShape:'circle', photoZoom:1,
};

// Merges a CV's saved settings over DEFAULTS. Both editor.js and
// dashboard.js need this exact same merge, so it lives here rather
// than being copy-pasted in both places (see this file's own header
// comment on why duplicated logic between those two files is the
// recurring bug class this file exists to avoid) — a thin wrapper
// today, but it's the one place either file should ever go through
// if a setting ever again needs anything beyond a plain default.
function mergeCvSettings(savedSettings) {
  return Object.assign({}, DEFAULTS, savedSettings || {});
}

/* ============================================================
   SECTION TYPE DEFINITIONS
   ============================================================ */
const SECTION_TYPES = {
  profile: {
    label: 'Professional Profile', icon: '👤',
    fields: [{ key:'summary', label:'Professional Summary', type:'textarea', allowAlign:true }],
    single: true
  },
  work: {
    label: 'Work Experience', icon: '💼',
    fields: [
      { key:'jobTitle',  label:'Job Title',  type:'text' },
      { key:'employer',  label:'Employer',   type:'text', linkable:true },
      { key:'startDate', label:'Start Date', type:'text', placeholder:'e.g. January 2020', clearable:true },
      { key:'endDate',   label:'End Date',   type:'text', placeholder:'e.g. Present', allowPresent:true, clearable:true },
      { key:'location',  label:'Location',   type:'text', placeholder:'City, Country' },
      { key:'desc',      label:'Description', type:'textarea', placeholder:'Describe your role and achievements...', allowAlign:true }
    ]
  },
  education: {
    label: 'Education', icon: '🎓',
    fields: [
      { key:'degree',    label:'Degree / Qualification',  type:'text' },
      { key:'school',    label:'School / Institution',    type:'text', linkable:true },
      { key:'startDate', label:'Start Date', type:'text', placeholder:'e.g. 2019', clearable:true },
      { key:'endDate',   label:'End Date',   type:'text', placeholder:'e.g. 2023', clearable:true },
      { key:'location',  label:'Location',   type:'text', placeholder:'City, Country' },
      { key:'desc',      label:'Description', type:'textarea', placeholder:'Relevant modules, achievements...', allowAlign:true }
    ]
  },
  skills: {
    label: 'Core Skills', icon: '🧠',
    fields: [
      { key:'skill', label:'Skill / Category',  type:'text' },
      { key:'info',  label:'Sub-skills / Info', type:'textarea', placeholder:'Specific skills, tools, methods...' },
      { key:'level', label:'Skill Level', type:'select',
        options: ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] }
    ]
  },
  certifications: {
    label: 'Certifications & Professional Development', icon: '🏅',
    fields: [
      { key:'name', label:'Certificate / Qualification', type:'text', linkable:true },
      { key:'date', label:'Date Earned',                 type:'text', placeholder:'e.g. June 2024', clearable:true },
      { key:'info', label:'Additional Information',      type:'textarea', placeholder:'Issuer, details...' }
    ]
  },
  languages: {
    label: 'Languages', icon: '🌍',
    fields: [
      { key:'language',    label:'Language',   type:'text' },
      { key:'proficiency', label:'Proficiency', type:'select',
        options: ['', 'Beginner', 'Elementary', 'Intermediate', 'Upper-Intermediate', 'Advanced', 'Native'] }
    ]
  },
  projects: {
    label: 'Projects', icon: '🚀',
    fields: [
      { key:'title',     label:'Project Title',  type:'text', linkable:true },
      { key:'role',      label:'Your Role',      type:'text' },
      { key:'startDate', label:'Start Date',     type:'text', clearable:true },
      { key:'endDate',   label:'End Date',       type:'text', allowPresent:true, clearable:true },
      { key:'desc',      label:'Description',    type:'textarea', placeholder:'Challenges, your role, impact...', allowAlign:true }
    ]
  },
  awards: {
    label: 'Awards', icon: '🏆',
    fields: [
      { key:'title',   label:'Award Title',  type:'text', linkable:true },
      { key:'issuer',  label:'Issuer',       type:'text' },
      { key:'date',    label:'Date',         type:'text', clearable:true },
      { key:'desc',    label:'Description',  type:'textarea', allowAlign:true }
    ]
  },
  courses: {
    label: 'Courses', icon: '📚',
    fields: [
      { key:'title',     label:'Course Title',  type:'text' },
      { key:'provider',  label:'Institution',   type:'text', linkable:true },
      { key:'startDate', label:'Start Date',    type:'text', clearable:true },
      { key:'endDate',   label:'End Date',      type:'text', clearable:true },
      { key:'location',  label:'Location',      type:'text' },
      { key:'desc',      label:'Description',   type:'textarea', allowAlign:true }
    ]
  },
  organisations: {
    label: 'Organisations', icon: '🏢',
    fields: [
      { key:'name',     label:'Organisation', type:'text', linkable:true },
      { key:'role',     label:'Role',         type:'text' },
      { key:'start',    label:'Start Date',   type:'text', clearable:true },
      { key:'end',      label:'End Date',     type:'text', clearable:true },
      { key:'location', label:'Location',     type:'text' },
      { key:'desc',     label:'Description',  type:'textarea', allowAlign:true }
    ]
  },
  publications: {
    label: 'Publications', icon: '📰',
    fields: [
      { key:'title',     label:'Title',        type:'text', linkable:true },
      { key:'publisher', label:'Publisher',    type:'text' },
      { key:'date',      label:'Date',         type:'text', clearable:true },
      { key:'desc',      label:'Description',  type:'textarea', allowAlign:true }
    ]
  },
  references: {
    label: 'References', icon: '👥',
    fields: [
      { key:'name',     label:'Full Name',   type:'text', linkable:true },
      { key:'position', label:'Position',    type:'text' },
      { key:'company',  label:'Company',     type:'text' },
      { key:'email',    label:'Email',       type:'text' },
      { key:'phone',    label:'Phone',       type:'text' }
    ]
  },
  interests: {
    label: 'Interests', icon: '⭐',
    fields: [
      { key:'interest', label:'Interest',    type:'text', linkable:true },
      { key:'desc',     label:'Description', type:'textarea' }
    ]
  },
  declaration: {
    label: 'Declaration', icon: '✍️',
    fields: [
      { key:'statement',     label:'Declaration Statement', type:'textarea',
        placeholder:'I hereby declare that the information provided above is true and accurate to the best of my knowledge.' },
      { key:'signatureName', label:'Signature (typed name)', type:'text', placeholder:'Your full name' },
      { key:'date',          label:'Date',                   type:'text', placeholder:'e.g. June 2026', clearable:true }
    ],
    single: true
  },
  custom: {
    label: 'Custom Section', icon: '✏️',
    useTextarea: true
  }
};

// Custom Section field sets for the "Normal" and "Skill" subtypes —
// see getSectionDef(). Mirrors Projects (Normal) and Skills (Skill)
// so structured custom sections get the exact same rich entry-editor
// UI those already have, no new rendering paths needed.
const CUSTOM_NORMAL_FIELDS = [
  { key:'title',     label:'Title',        type:'text', linkable:true },
  { key:'subtitle',  label:'Subtitle',     type:'text' },
  { key:'startDate', label:'Start Date',   type:'text', clearable:true },
  { key:'endDate',   label:'End Date',     type:'text', allowPresent:true, clearable:true },
  { key:'location',  label:'Location',     type:'text' },
  { key:'desc',      label:'Description',  type:'textarea', placeholder:'Details...', allowAlign:true }
];
const CUSTOM_SKILL_FIELDS = [
  { key:'skill', label:'Skill / Category',  type:'text' },
  { key:'info',  label:'Sub-skills / Info', type:'textarea', placeholder:'Specific skills, tools, methods...' },
  { key:'level', label:'Skill Level', type:'select', options: ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] }
];
// Every standard section type's own default icon (👤💼🎓 etc, see
// SECTION_TYPES above) plus a set of extras for Custom Section /
// re-picking on any section: one shared list so the dropdown always
// includes whatever icon a section already has, standard or not.
const CUSTOM_SECTION_ICONS = ['👤','💼','🎓','🧠','🏅','🌍','🚀','🏆','📚','🏢','📰','👥','⭐','✍️','✏️','🎯','🛠️','💡','📌','🔖','📊','🎨','🎵','⚡','🌟','🔧','📱','💻','🎬','🏋️'];

// Single source of truth for "what field set / icon does this section
// actually use right now" — every renderer should call this instead of
// indexing SECTION_TYPES directly, so a Custom Section's subtype
// override (see cvData.customSectionType) is respected everywhere.
// Falls back to the plain freeform-textarea behavior when no override
// is set, which is exactly what every existing CV already has, so
// nothing changes for CVs that never touch this new setting.
// Maps a Custom Section's subtype to the stype string renderEntryHTML
// actually branches on — 'custom-normal' is handled identically to
// 'projects', 'custom-skill' identically to 'skills' (see
// renderEntryHTML). Every other section type is unaffected.
function getEffectiveStype(sec, i) {
  const stype = sec.type || 'custom';
  if (stype === 'custom') {
    const subtype = cvData.customSectionType[i];
    if (subtype === 'normal') return 'custom-normal';
    if (subtype === 'skill')  return 'custom-skill';
  }
  return stype;
}

function getSectionDef(sec, i) {
  const stype = sec.type || 'custom';
  const baseDef = SECTION_TYPES[stype] || SECTION_TYPES.custom;
  // Every section type ships a sensible default icon (SECTION_TYPES'
  // own icon), but any section, not just Custom Section, can override
  // it via the icon dropdown in its accordion header: cvData
  // .customSectionIcon is keyed by section index, not by type, so it
  // doubles as the single override store for both.
  const icon = cvData.customSectionIcon[i] || baseDef.icon;
  if (stype === 'custom') {
    const subtype = cvData.customSectionType[i];
    if (subtype === 'normal') return { label: baseDef.label, icon, fields: CUSTOM_NORMAL_FIELDS, useTextarea: false };
    if (subtype === 'skill')  return { label: baseDef.label, icon, fields: CUSTOM_SKILL_FIELDS,  useTextarea: false };
    return { ...baseDef, icon };
  }
  return { ...baseDef, icon };
}

// Shared by both heading-rendering call sites (real pagination's
// buildSectionUnits and the flowing/two-col/sidebar path's
// renderSectionPreview) so the icon only ever needs wiring up once.
function sectionHeadingInnerHTML(name, icon) {
  const iconHtml = (cvSettings.showSectionIcons && icon) ? `<span class="cvp-sec-icon">${escapeHtml(icon)}</span>` : '';
  return iconHtml + escapeHtml(name);
}

const CONTACT_FIELD_META = {
  email:          { label: 'Email',            type: 'email', icon: '✉' },
  phone:          { label: 'Phone',             type: 'text',  icon: '☎' },
  location:       { label: 'Location',          type: 'text',  icon: '📍' },
  linkedin:       { label: 'LinkedIn URL',      type: 'text',  icon: 'in' },
  website:        { label: 'Website',           type: 'text',  icon: '🌐' },
  portfolio:      { label: 'Portfolio URL',     type: 'text',  icon: '🎨' },
  github:         { label: 'GitHub',            type: 'text',  icon: '⌥' },
  twitter:        { label: 'Twitter / X',       type: 'text',  icon: '𝕏' },
  nationality:    { label: 'Nationality',       type: 'text',  icon: '🌍' },
  dob:            { label: 'Date of Birth',     type: 'text',  icon: '🎂' },
  visaStatus:     { label: 'Visa Status',       type: 'text',  icon: '🛂' },
  availability:   { label: 'Availability',      type: 'text',  icon: '📅' },
  drivingLicense: { label: 'Driving License',   type: 'text',  icon: '🚗' },
  maritalStatus:  { label: 'Marital Status',    type: 'text',  icon: '💍' },
};

function getSummaryHtml(sections) {
  const profileSec = sections.find(s => (s.type || 'custom') === 'profile');
  const text = profileSec?.entries?.[0]?.summary || '';
  return text ? `<div class="cvp-header-summary">${mdLine(text)}</div>` : '';
}

// Photo frame shape (circle/rounded/square) is a CSS class on the frame;
// zoom is a CSS custom property read by the img inside it, so it applies
// identically whether the photo lives on #cvPaper (fallback layout) or
// gets copied per .cv-page (real pagination) — see applyStyleProps.
function buildPhotoHtml(header) {
  if (!header.photo || cvData.hiddenFields['photo']) return '';
  const shape = cvSettings.photoShape || 'circle';
  return `<div class="cvp-photo-frame cvp-photo-${shape}"><img class="cvp-photo" src="${escapeAttr(header.photo)}" alt=""></div>`;
}

function buildContactHtml(header) {
  const order = cvData.headerFieldOrder.filter(key => !cvData.hiddenFields[key] && header[key]);
  if (!order.length) {
    if (header.contact && !cvData.hiddenFields['contact']) return mdLine(header.contact);
    return '';
  }
  if (cvSettings.iconStyle === 'none') {
    return mdLine(order.map(key => header[key]).join(' | '));
  }
  return order.map(key => {
    const meta = CONTACT_FIELD_META[key];
    const icon = (meta && meta.icon) || '•';
    return `<span class="cvp-contact-item"><span class="cvp-contact-icon">${escapeHtml(icon)}</span><span class="cvp-contact-text">${mdLine(header[key])}</span></span>`;
  }).join('');
}

function buildCustomFooterHTML(header) {
  const fill = (text) => escapeHtml(text)
    .replace(/\{\{name\}\}/gi,  escapeHtml(header.name||''))
    .replace(/\{\{email\}\}/gi, escapeHtml(header.email||''))
    .replace(/\{\{phone\}\}/gi, escapeHtml(header.phone||''))
    .replace(/\{\{pages\}\}/gi, '<span class="cvp-footer-pages">1</span>');
  const left   = fill(cvSettings.footerLeft);
  const center = fill(cvSettings.footerCenter);
  const right  = fill(cvSettings.footerRight);
  if (!left && !center && !right) return '';
  return `<div class="cvp-footer cvp-footer-custom">
    <span class="cvp-footer-zone cvp-footer-left">${left}</span>
    <span class="cvp-footer-zone cvp-footer-center">${center}</span>
    <span class="cvp-footer-zone cvp-footer-right">${right}</span>
  </div>`;
}

function renderSectionPreview(sec, i) {
  // "Summary as part of header" moves the Professional Summary's text
  // into the header block (see buildContactHtml call sites) instead of
  // its own section — skip rendering it a second time here.
  if ((sec.type || 'custom') === 'profile' && cvSettings.summaryInHeader) return '';
  const name  = cvData.sectionNames[i] !== undefined ? cvData.sectionNames[i] : sec.title;
  const stype = sec.type || 'custom';
  const def   = getSectionDef(sec, i);
  const renderStype = getEffectiveStype(sec, i);
  let body = '';

  if (def && !def.useTextarea && sec.entries && sec.entries.length) {
    body = sec.entries.filter(e=>e.visible!==false).map(e=>renderEntryHTML(e, renderStype)).join('');
  } else {
    body = formatLines(sec.lines || []);
  }

  return `<div class="cvp-section" id="preview-sec-${i}">
    <div class="cvp-sec-heading">${sectionHeadingInnerHTML(name, def.icon)}</div>
    <div class="cvp-sec-content" id="preview-content-${i}">${body}</div>
  </div>`;
}

// "Icon Bullets" template swaps the plain bullet/hyphen character for
// a checkmark glyph — the character is baked directly into rendered
// text (not a CSS list-style), so this is the one place both callers
// (structured entries and freeform textarea lines) need to check.
function getBulletChar() {
  if (cvSettings.template === 'icon-bullets') return '✓';
  return cvSettings.listStyle==='hyphen'?'–':'•';
}

function renderEntryHTML(entry, stype) {
  const bullet = getBulletChar();
  let html = '';

  if (stype==='profile') {
    const align = entry.summaryAlign && entry.summaryAlign!=='left' ? ` style="text-align:${entry.summaryAlign}"` : '';
    html += `<p class="cvp-line"${align}>${mdLine(entry.summary||'')}</p>`;
    return html;
  }

  if (stype==='work'||stype==='education'||stype==='projects'||stype==='courses'||stype==='organisations'||stype==='custom-normal') {
    const title   = entry.jobTitle||entry.degree||entry.title||entry.course||entry.name||'';
    const sub     = entry.employer||entry.school||entry.role||entry.provider||entry.organisation||entry.subtitle||'';
    const subLink = entry.employerLink||entry.schoolLink||entry.providerLink||entry.organisationLink||'';
    const start   = formatDate(entry.startDate||entry.start||'');
    const end     = formatDate(entry.endDate||entry.end||'');
    const loc     = entry.location||'';
    const desc    = entry.desc||'';
    const descAlign = entry.descAlign && entry.descAlign!=='left' ? ` style="text-align:${entry.descAlign}"` : '';
    let dateStr   = '';
    if (start||end) {
      dateStr = [start, end].filter(Boolean).join(' – ');
      if (cvSettings.showDuration && start && end) {
        dateStr += ' ' + calcDuration(entry.startDate||entry.start||'', entry.endDate||entry.end||'');
      }
    }
    const subHtml   = subLink ? `<a href="${escapeAttr(subLink)}" target="_blank" rel="noopener">${escapeHtml(sub)}</a>` : escapeHtml(sub);
    // Title/Subtitle Order: which field (job title vs employer/school)
    // leads in row 1. The CSS class stays tied to the field's MEANING
    // (title keeps .cvp-entry-title, subtitle keeps .cvp-entry-employer)
    // regardless of which row it's placed in, so Subtitle Style / accent
    // color targeting keeps working correctly either way.
    const titleOrder = stype==='work' ? cvSettings.workTitleOrder : stype==='education' ? cvSettings.eduTitleOrder : 'normal';
    const swapped = titleOrder === 'swapped';
    // Row 1: job title left, date range right. Row 2: employer left, location right.
    // Keeps company/date/location as distinct fields all the way to markup,
    // instead of collapsing them into one pipe-joined flowing paragraph.
    // "Subtitle: Same Line" folds employer into row 1 next to the title
    // (its pre-existing meaning), leaving row 2 for location only.
    if (cvSettings.subtitleLine === 'same') {
      const titleHtml = [
        title ? `<span class="cvp-entry-title">${mdLine(title)}</span>` : '',
        sub   ? `<span class="cvp-entry-employer cvp-entry-employer-inline">${subHtml}</span>` : ''
      ].filter(Boolean).join('');
      if (titleHtml||dateStr) html += `<div class="cvp-entry-row1">
        <span>${titleHtml}</span>
        ${dateStr ? `<span class="cvp-entry-date">${escapeHtml(dateStr)}</span>` : ''}
      </div>`;
      if (loc) html += `<div class="cvp-entry-row2"><span></span><span class="cvp-entry-location">${escapeHtml(loc)}</span></div>`;
    } else if (swapped) {
      if (sub||dateStr) html += `<div class="cvp-entry-row1">
        ${sub ? `<span class="cvp-entry-employer">${subHtml}</span>` : '<span></span>'}
        ${dateStr ? `<span class="cvp-entry-date">${escapeHtml(dateStr)}</span>` : ''}
      </div>`;
      if (title||loc) html += `<div class="cvp-entry-row2">
        ${title ? `<span class="cvp-entry-title">${mdLine(title)}</span>` : '<span></span>'}
        ${loc ? `<span class="cvp-entry-location">${escapeHtml(loc)}</span>` : ''}
      </div>`;
    } else {
      if (title||dateStr) html += `<div class="cvp-entry-row1">
        ${title ? `<span class="cvp-entry-title">${mdLine(title)}</span>` : '<span></span>'}
        ${dateStr ? `<span class="cvp-entry-date">${escapeHtml(dateStr)}</span>` : ''}
      </div>`;
      if (sub||loc) html += `<div class="cvp-entry-row2">
        ${sub ? `<span class="cvp-entry-employer">${subHtml}</span>` : '<span></span>'}
        ${loc ? `<span class="cvp-entry-location">${escapeHtml(loc)}</span>` : ''}
      </div>`;
    }
    if (desc) {
      desc.split('\n').forEach(line => {
        const t = line.trim();
        if (!t) return;
        if (/^[•–-]\s/.test(t)) {
          html += `<p class="cvp-bullet"${descAlign} style="break-inside:avoid">${bullet} ${mdLine(t.replace(/^[•–-]\s+/,''))}</p>`;
        } else {
          html += `<p class="cvp-line"${descAlign}>${mdLine(t)}</p>`;
        }
      });
    }
    return html;
  }

  if (stype==='skills'||stype==='custom-skill') {
    const skill = entry.skill||'';
    const info  = entry.info||'';
    const level = entry.level||'';
    if (skill&&info) html += `<p class="cvp-line"><strong class="cvp-cat">${escapeHtml(skill)}:</strong> ${mdLine(info)}</p>`;
    else if (skill)  html += `<p class="cvp-line"><strong class="cvp-cat">${escapeHtml(skill)}</strong>${level?' — '+level:''}</p>`;
    return html;
  }

  if (stype==='certifications') {
    const name = entry.name||'';
    const nameLink = entry.nameLink||'';
    const nameHtml = nameLink ? `<a href="${escapeAttr(nameLink)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>` : escapeHtml(name);
    const date = formatDate(entry.date||'');
    const info = entry.info||'';
    html += `<p class="cvp-line"><strong>${nameHtml}</strong>${date?' — Date: '+escapeHtml(date):''}${info?'\n'+info:''}</p>`;
    return html;
  }

  if (stype==='languages') {
    html += `<p class="cvp-line">${escapeHtml(entry.language||'')}${entry.proficiency?' — '+entry.proficiency:''}</p>`;
    return html;
  }

  if (stype==='awards'||stype==='publications'||stype==='interests') {
    const title = entry.title||entry.interest||'';
    const titleLink = entry.titleLink||entry.interestLink||'';
    const titleHtml = titleLink ? `<a href="${escapeAttr(titleLink)}" target="_blank" rel="noopener">${mdLine(title)}</a>` : mdLine(title);
    const sub   = [entry.issuer||entry.publisher, entry.date ? formatDate(entry.date) : ''].filter(Boolean).join(' — ');
    const desc  = entry.desc||'';
    const descAlign = entry.descAlign && entry.descAlign!=='left' ? ` style="text-align:${entry.descAlign}"` : '';
    if (title) html += `<p class="cvp-entry-title">${titleHtml}</p>`;
    if (sub)   html += `<p class="cvp-entry-meta">${escapeHtml(sub)}</p>`;
    if (desc)  html += `<p class="cvp-line"${descAlign}>${mdLine(desc)}</p>`;
    return html;
  }

  if (stype==='declaration') {
    const statement = entry.statement||'';
    const sigName   = entry.signatureName||'';
    const date      = formatDate(entry.date||'');
    if (statement) html += `<p class="cvp-line">${mdLine(statement)}</p>`;
    if (sigName) html += `<p class="cvp-signature">${escapeHtml(sigName)}</p>`;
    if (date) html += `<p class="cvp-entry-meta">${escapeHtml(date)}</p>`;
    return html;
  }

  if (stype==='references') {
    const nameLink = entry.nameLink||'';
    const nameHtml = nameLink ? `<a href="${escapeAttr(nameLink)}" target="_blank" rel="noopener">${escapeHtml(entry.name||'')}</a>` : escapeHtml(entry.name||'');
    html += `<p class="cvp-entry-title">${nameHtml}</p>`;
    if (entry.position||entry.company) html += `<p class="cvp-entry-meta">${escapeHtml([entry.position,entry.company].filter(Boolean).join(', '))}</p>`;
    if (entry.email||entry.phone) html += `<p class="cvp-line">${escapeHtml([entry.email,entry.phone].filter(Boolean).join(' | '))}</p>`;
    return html;
  }

  // Generic fallback
  return `<p class="cvp-line">${escapeHtml(JSON.stringify(entry))}</p>`;
}

/* ============================================================
   DATE / DURATION HELPERS
   ============================================================ */
const MONTH_MAP = {jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December'};
const MONTH_NUM = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
const MONTH_ABBR = {jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec'};

// Shared by both match branches below: render a month/year pair once the
// 3-letter abbreviation and year are known, for any supported dateFormat.
function formatMonthYear(abbr, year, fallback) {
  const fmt = cvSettings.dateFormat || 'Month YYYY';
  if (fmt === 'Month YYYY') return `${MONTH_MAP[abbr] || fallback} ${year}`;
  if (fmt === 'Mon YYYY')   return `${MONTH_ABBR[abbr] || fallback} ${year}`;
  if (fmt === 'MM/YYYY')    return `${MONTH_NUM[abbr] || '01'}/${year}`;
  if (fmt === 'MM.YYYY')    return `${MONTH_NUM[abbr] || '01'}.${year}`;
  if (fmt === 'YYYY')       return year;
  return fallback ? `${fallback} ${year}` : year;
}

/* Format a single date string ("Jan 2020", "January 2020", "2020", "Present")
   according to cvSettings.dateFormat: 'Month YYYY' | 'Mon YYYY' | 'MM/YYYY' | 'MM.YYYY' | 'YYYY' */
function formatDate(str) {
  if (!str) return '';
  const clean = str.trim();
  if (/^present$/i.test(clean)) return 'Present';

  // "Jan 2020" / "January 2020"
  const mY = clean.match(/^(\w{3,9})\s+(\d{4})$/i);
  if (mY) {
    const abbr = mY[1].slice(0,3).toLowerCase();
    return formatMonthYear(abbr, mY[2], mY[1]);
  }

  // "2020-01" / "2020-1"
  const yM = clean.match(/^(\d{4})-(\d{1,2})$/);
  if (yM) {
    const year = yM[1], mon = yM[2].padStart(2,'0');
    const abbr = Object.keys(MONTH_NUM).find(k => MONTH_NUM[k] === mon);
    return formatMonthYear(abbr, year, mon);
  }

  // Plain year only — nothing to convert for Month/MM formats, just return as-is
  if (/^\d{4}$/.test(clean)) return clean;

  return clean;
}

function parseDateToMs(s) {
  if(!s||/^present$/i.test(s.trim())) return Date.now();
  const c=s.trim();
  const mY=c.match(/^(\w{3,9})\s+(\d{4})$/i);
  if(mY){ const a=mY[1].slice(0,3).toLowerCase(); return new Date(parseInt(mY[2]),parseInt(MONTH_NUM[a]||'1',10)-1).getTime(); }
  const y=c.match(/^(\d{4})$/); if(y) return new Date(parseInt(y[1]),0).getTime();
  return 0;
}

function calcDuration(start,end) {
  const ms=parseDateToMs(end)-parseDateToMs(start);
  if(ms<=0) return '';
  const m=Math.round(ms/(1000*60*60*24*30.44));
  const yr=Math.floor(m/12), mo=m%12;
  const p=[];
  if(yr) p.push(`${yr} yr${yr>1?'s':''}`);
  if(mo) p.push(`${mo} mo${mo>1?'s':''}`);
  return p.length?`· ${p.join(' ')}`:'' ;
}

/* ============================================================
   formatLines (for textarea / custom sections)
   ============================================================ */
function formatLines(lines) {
  const bullet = getBulletChar();
  const result = [];
  for(let i=0;i<lines.length;i++){
    const t=lines[i].trim();
    if(!t){result.push('<div class="cvp-gap"></div>');continue;}
    if(/^[•–]\s/.test(t)||/^-\s/.test(t)){ result.push(`<p class="cvp-bullet" style="break-inside:avoid">${bullet} ${mdLine(t.replace(/^[•–-]\s+/,''))}</p>`); continue; }
    if(t.includes(' | ')&&/(Present|\d{4})/i.test(t)){ result.push(`<p class="cvp-entry-meta">${escapeHtml(t)}</p>`); continue; }
    const next=(lines[i+1]||'').trim();
    if(next.includes(' | ')&&/(Present|\d{4})/i.test(next)){ result.push(`<p class="cvp-entry-title">${mdLine(t)}</p>`); continue; }
    const cat=t.match(/^([^:•|–-]{2,50}):\s+(.+)$/);
    if(cat&&!/^\d/.test(cat[1])){ result.push(`<p class="cvp-line"><strong class="cvp-cat">${escapeHtml(cat[1])}:</strong> ${mdLine(cat[2])}</p>`); continue; }
    result.push(`<p class="cvp-line">${mdLine(t)}</p>`);
  }
  return result.join('');
}

function mdLine(text) {
  return (text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<u>$1</u>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>');
}

function escapeHtml(s){ const d=document.createElement('div'); d.appendChild(document.createTextNode(s||'')); return d.innerHTML; }
function escapeAttr(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Single source of truth for the class string that carries every
// template/accent/style modifier — used both by applySettings() (for
// the fallback path, applied straight to #cvPaper) and by the real
// -pagination path (applied to each .cv-page instead, since #cvPaper
// becomes a plain stacking wrapper there). excludePageNum drops the
// 'show-pagenum' token: the hardcoded ::after page-number text isn't
// meaningful once there are real repeated pages (see plan's footer
// descope), so it's suppressed rather than shown wrong on every page.
function computeCvPaperClassString(excludePageNum) {
  const colMode = String(cvSettings.columns);
  const colClass = colMode==='2' ? 'cols-2' : colMode==='mix' ? 'cols-mix' : 'cols-1';
  const sidebarPosClass = (colMode==='2' && cvSettings.sidebarPosition==='right') ? 'sidebar-pos-right' : 'sidebar-pos-left';
  const sidebarBgClass  = (colMode==='2' && cvSettings.sidebarBgEnabled) ? 'sidebar-has-bg' : 'sidebar-no-bg';
  const accentClasses = [
    cvSettings.accentName     ?'ac-name':'', cvSettings.accentTitle    ?'ac-title':'',
    cvSettings.accentHeadings ?'ac-headings':'', cvSettings.accentLine  ?'ac-line':'',
    cvSettings.accentDates    ?'ac-dates':'', cvSettings.accentSubtitle ?'ac-subtitle':'',
    cvSettings.accentIcons    ?'ac-icons':'', cvSettings.accentLinkIcons?'ac-linkicons':'',
    (cvSettings.showPageNums && !excludePageNum) ?'show-pagenum':'', colClass, sidebarPosClass, sidebarBgClass,
  ].filter(Boolean).join(' ');
  return ['cv-paper',`t-${cvSettings.template}`,`hs-${cvSettings.headingStyle}`,
    `hc-${cvSettings.headingCase}`,`ss-${cvSettings.subtitleStyle}`,`ds-${cvSettings.dateStyle}`,
    `lc-${cvSettings.locationStyle}`,`sl-${cvSettings.subtitleLine}`,`ic-${cvSettings.iconStyle}`,
    `ls-${cvSettings.linkStyle}`,accentClasses].filter(Boolean).join(' ');
}

function buildCVHTML(parsed) {
  const { header, sections } = parsed;
  const colMode  = String(cvSettings.columns);
  const isTwoCol = colMode === '2';
  const isMix    = colMode === 'mix';
  const isSidebarTemplate = isTwoCol && SIDEBAR_TEMPLATES.includes(cvSettings.template);

  const hf = header;
  const contactHtml = buildContactHtml(hf);

  let headerTextInner = '';
  const targetNameFont = (cvSettings.nameFont && cvSettings.nameFont !== 'inherit') ? cvSettings.nameFont : (cvSettings.bodyFont || '');
  const isCursive = targetNameFont && (targetNameFont.toLowerCase().includes('cursive') || targetNameFont.toLowerCase().includes('parisienne') || targetNameFont.toLowerCase().includes('pacifico') || targetNameFont.toLowerCase().includes('caveat') || targetNameFont.toLowerCase().includes('bungee'));
  const nameStyle = targetNameFont
    ? ` style="font-family:${escapeAttr(targetNameFont)} !important;${isCursive ? 'text-transform:none !important;font-weight:400 !important;' : ''}"`
    : '';
  if (!cvData.hiddenFields['name'])     headerTextInner += `<div class="cvp-name"${nameStyle}>${mdLine(hf.name||'')}</div>`;
  if (!cvData.hiddenFields['jobTitle'] && hf.jobTitle) headerTextInner += `<div class="cvp-jobtitle">${mdLine(hf.jobTitle)}</div>`;
  if (contactHtml) headerTextInner += `<div class="cvp-contact">${contactHtml}</div>`;
  if (cvSettings.summaryInHeader) headerTextInner += getSummaryHtml(sections);
  const photoHtml = buildPhotoHtml(hf);
  const headerInner = photoHtml
    ? `<div class="cvp-header-row">${photoHtml}<div class="cvp-header-text">${headerTextInner}</div></div>`
    : headerTextInner;

  // Header Position (Left/Right) only applies to the generic two-column
  // layout: sidebar templates already dedicate the header to their own
  // permanent colored panel, and that's a different, established design
  // this shouldn't interfere with.
  const headerPos = cvSettings.headerPosition || 'top';
  const headerInColumn = isTwoCol && !isSidebarTemplate && (headerPos === 'left' || headerPos === 'right');

  let html = '';
  if (!headerInColumn) {
    html += '<div class="cvp-header">' + headerInner;
    if (isSidebarTemplate) {
      // These templates' header IS the colored side panel (see main.css
      // "Shared sidebar base"), so sections assigned to the sidebar render
      // inside it directly and inherit its color, instead of spawning a
      // separate flat-colored box elsewhere in the layout.
      const sidebar = sections.map((s,i)=>({s,i})).filter(({i})=>cvData.columnAssign[i]==='sidebar');
      html += '<div class="cvp-header-sections">' + sidebar.map(({s,i})=>renderSectionPreview(s,i)).join('') + '</div>';
    }
    html += '</div><hr class="cvp-divider">';
  }

  if (isSidebarTemplate) {
    const main = sections.map((s,i)=>({s,i})).filter(({i})=>(cvData.columnAssign[i]||'main')==='main');
    html += main.map(({s,i})=>renderSectionPreview(s,i)).join('');
  } else if (isTwoCol) {
    const main    = sections.map((s,i)=>({s,i})).filter(({i})=>(cvData.columnAssign[i]||'main')==='main');
    const sidebar = sections.map((s,i)=>({s,i})).filter(({i})=>cvData.columnAssign[i]==='sidebar');
    const headerBlock = headerInColumn ? `<div class="cvp-header cvp-header-incolumn">${headerInner}</div>` : '';
    const isSidebarRight = cvSettings.sidebarPosition === 'right';
    const sidebarHtml = '<div class="cv-sidebar-col">' + (headerPos==='left'?headerBlock:'') + sidebar.map(({s,i})=>renderSectionPreview(s,i)).join('') + '</div>';
    const mainHtml    = '<div class="cv-main-col">'    + (headerPos==='right'?headerBlock:'') + main.map(({s,i})=>renderSectionPreview(s,i)).join('')    + '</div>';
    html += '<div class="cv-two-col-wrap">';
    html += isSidebarRight ? (mainHtml + sidebarHtml) : (sidebarHtml + mainHtml);
    html += '</div>';
  } else if (isMix) {
    // Walk sections in order; pair up consecutive 'half' width sections into a flex row
    html += '<div class="cv-mix-area">';
    let i = 0;
    while (i < sections.length) {
      const width = cvData.sectionWidth[i] || 'full';
      if (width === 'half') {
        const nextWidth = cvData.sectionWidth[i+1] || 'full';
        if (nextWidth === 'half' && i+1 < sections.length) {
          html += `<div class="cv-mix-row">
            <div class="cv-mix-half">${renderSectionPreview(sections[i], i)}</div>
            <div class="cv-mix-half">${renderSectionPreview(sections[i+1], i+1)}</div>
          </div>`;
          i += 2;
          continue;
        } else {
          // Lone half-width section — render full-width row containing one half slot
          html += `<div class="cv-mix-row"><div class="cv-mix-half">${renderSectionPreview(sections[i], i)}</div></div>`;
          i += 1;
          continue;
        }
      }
      html += renderSectionPreview(sections[i], i);
      i += 1;
    }
    html += '</div>';
  } else {
    html += '<div class="cv-sections-area">';
    sections.forEach((sec,i) => { html += renderSectionPreview(sec, i); });
    html += '</div>';
  }
  if (cvSettings.footerCustom) {
    html += buildCustomFooterHTML(header);
  } else if (cvSettings.showPageNums) {
    html += '<div class="cvp-footer"><span class="cvp-pagenum">Page 1</span></div>';
  }
  return html;
}
