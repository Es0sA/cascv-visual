/* ============================================================
   CAS CV Builder — dashboard.js
   Handles gallery rendering, modal, and CV actions.
   CV data lives in Firestore (users/{uid}/cvs/{cvId}), reached
   through window.CVStore (see js/cv-store.js). This file itself
   stays a classic global-scope script; only the Firestore calls
   are async.
   ============================================================ */

// Auth is now handled by auth-guard.js (Firebase) — see js/auth-guard.js

// In-memory copy of whatever CVStore.getAll() last returned, so
// actions like download/delete don't need a fresh Firestore read.
let cachedCVs = [];

// Elements
const logoutBtn     = document.getElementById('logoutBtn');
const newCvBtn      = document.getElementById('newCvBtn');
const newCvBtnEmpty = document.getElementById('newCvBtnEmpty');
const modalOverlay  = document.getElementById('modalOverlay');
const modalClose    = document.getElementById('modalClose');
const optionImport  = document.getElementById('optionImport');
const optionScratch = document.getElementById('optionScratch');
const cvCountEl     = document.getElementById('cvCount');
const emptyState    = document.getElementById('emptyState');
const cvGrid        = document.getElementById('cvGrid');

/* ---- Logout ---- */
logoutBtn.addEventListener('click', () => {
  if (typeof window.casSignOut === 'function') {
    window.casSignOut();
  } else {
    // Fallback, shouldn't normally happen since auth-guard.js
    // always runs first and defines this.
    window.location.href = 'index.html';
  }
});

/* ---- Modal ---- */
function openModal() {
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

newCvBtn.addEventListener('click', openModal);
newCvBtnEmpty.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ---- Option handlers ---- */
optionImport.addEventListener('click', () => {
  closeModal();
  window.location.href = 'import.html';
});

optionScratch.addEventListener('click', async () => {
  closeModal();
  const id = 'cv_' + Date.now();
  const blankCV = {
    id,
    name: 'Untitled CV',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    raw: '',
    parsed: {
      header: { name: '', jobTitle: '', email: '', phone: '', location: '', linkedin: '', contact: '' },
      sections: [
        { title: 'Professional Profile', type: 'profile', entries: [{ visible:true, summary:'' }], lines: [] },
        { title: 'Work Experience',      type: 'work',     entries: [], lines: [] },
        { title: 'Education',            type: 'education',entries: [], lines: [] },
        { title: 'Core Skills',          type: 'skills',   entries: [], lines: [] }
      ]
    },
    columnAssign: {},
    hiddenFields: {},
    sectionNames: {},
    sectionWidth: {},
    settings: {}
  };
  try {
    const CVStore = await window.cvStoreReady;
    await CVStore.save(blankCV);
    window.location.href = `editor.html?id=${id}`;
  } catch {
    alert('Could not create a new CV. Please try again.');
  }
});

/* ---- Gallery render ---- */
function renderGallery() {
  const cvs = cachedCVs;

  cvCountEl.textContent = cvs.length === 0
    ? '0 CVs saved'
    : `${cvs.length} CV${cvs.length === 1 ? '' : 's'} saved`;

  if (cvs.length === 0) {
    emptyState.style.display = 'flex';
    cvGrid.style.display     = 'none';
    return;
  }

  emptyState.style.display = 'none';
  cvGrid.style.display     = 'grid';

  cvGrid.innerHTML = cvs.map(cv => `
    <div class="cv-card" data-id="${cv.id}">
      <div class="cv-card-top">
        <div class="cv-card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div class="cv-card-info">
          <div class="cv-card-name">${escapeCardText(cv.name)}</div>
          ${cv.parsed?.header?.jobTitle ? `<div class="cv-card-jobtitle">${escapeCardText(cv.parsed.header.jobTitle)}</div>` : ''}
          <div class="cv-card-date">Last edited ${formatCardDate(cv.updatedAt || cv.createdAt)}</div>
        </div>
      </div>
      <div class="cv-card-actions">
        <button class="cv-action-btn" onclick="editCV('${cv.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Edit
        </button>
        <button class="cv-action-btn" onclick="downloadCV('${cv.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Download
        </button>
        <button class="cv-action-btn cv-action-btn--delete" onclick="deleteCV('${cv.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

/* ---- Actions ---- */
function editCV(id) {
  window.location.href = `editor.html?id=${id}`;
}

// Builds the PDF export payload using the SAME buildCVHTML()/
// computeCvPaperClassString() functions editor.js's own Download PDF
// button uses (see js/cv-render.js) instead of a separately maintained
// copy of that rendering logic. This file used to hand-roll its own
// renderSec()/header/footer markup from scratch, which repeatedly drifted
// out of sync with editor.js over time: missing profile photos, missing
// footers/page numbers, missing section icons, several style pickers
// (Date Style, Subtitle Style, Location Style, Icon Style, Link Style,
// six "accent color" toggles) and content-logic toggles (Show Duration,
// Subtitle Same Line, Title/Subtitle Order) all silently had no effect
// on PDFs downloaded from the gallery, even though the exact same
// settings worked correctly from the editor's own Download button.
function downloadCV(id) {
  const cv = cachedCVs.find(c => c.id === id);
  if (!cv) { alert('CV not found.'); return; }

  // Populate the shared cvData/cvSettings globals (declared in
  // js/cv-render.js) from this CV's Firestore document, applying the
  // exact same safety-net defaults initEditor() applies in editor.js,
  // so buildCVHTML() sees the same shape of data it always does.
  cvData = cv;
  cvData.columnAssign      = cvData.columnAssign      || {};
  cvData.hiddenFields      = cvData.hiddenFields      || {};
  cvData.sectionNames      = cvData.sectionNames      || {};
  cvData.sectionWidth      = cvData.sectionWidth      || {};
  cvData.headerFieldOrder  = cvData.headerFieldOrder  || ['email','phone','location','linkedin'];
  cvData.customSectionType = cvData.customSectionType || {};
  cvData.customSectionIcon = cvData.customSectionIcon || {};
  cvSettings = mergeCvSettings(cv.settings);

  const btn = (typeof event !== 'undefined' && event && event.target) ? event.target.closest('button') : null;
  if (btn) { btn.textContent = '⏳ Generating…'; btn.disabled = true; }

  (async () => {
    try {
      const payload = await buildBackendExportPayload();
      await casGeneratePdf(payload);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed. Please try again (if this keeps happening, let Cas know).');
    } finally {
      if (btn) { btn.textContent = 'Download'; btn.disabled = false; }
    }
  })();
}

async function deleteCV(id) {
  if (!confirm('Delete this CV? This cannot be undone.')) return;
  try {
    const CVStore = await window.cvStoreReady;
    await CVStore.remove(id);
    cachedCVs = cachedCVs.filter(cv => cv.id !== id);
    renderGallery();
  } catch {
    alert('Could not delete this CV. Please try again.');
  }
}

/* ---- Helpers ----
   Named distinctly from js/cv-render.js's own formatDate()/escapeHtml():
   this file used to define its own same-named formatDate(iso)/
   escapeHtml(str) here for gallery-card-only purposes (an ISO
   timestamp formatter for "Last edited", and an HTML escaper that
   falls back to the literal string "Untitled CV" for a blank card
   title) — completely different semantics than the CV-content date
   formatter and generic HTML escaper cv-render.js now also defines.
   Since this file loads AFTER cv-render.js, its same-named functions
   silently overrode the shared ones in the global scope: every date
   in every CV entry rendered via buildCVHTML() came out "Invalid
   Date" (this file's formatDate expects an ISO timestamp, not a
   "Month YYYY" CV date string), and any blank field anywhere in a
   CV's content rendered as the literal text "Untitled CV" instead of
   nothing. Caught by comparing the editor's and dashboard's export
   payloads byte-for-byte after the refactor and finding they weren't
   identical. */
function formatCardDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function escapeCardText(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || 'Untitled CV'));
  return d.innerHTML;
}

/* ---- Init ---- */
async function boot() {
  cvCountEl.textContent = 'Loading…';
  emptyState.style.display = 'none';
  cvGrid.style.display     = 'block';
  cvGrid.innerHTML = '<p class="cv-loading-text">Loading your CVs…</p>';

  try {
    const CVStore = await window.cvStoreReady;
    await CVStore.migrateIfNeeded();
    cachedCVs = await CVStore.getAll();
  } catch {
    cvCountEl.textContent = '';
    cvGrid.innerHTML = '<p class="cv-loading-text">Could not load your CVs. Please refresh the page.</p>';
    return;
  }

  renderGallery();
}

boot();

// Reported by Cas: the Dashboard's Download button produced a CV that
// looked visually different (colors/styling) from what Editor's own
// Download PDF or Customize panel showed for the exact same CV. The
// underlying color/style computation itself checked out correct in
// isolation, so the more likely explanation is staleness: cachedCVs is
// only ever populated once, when this script first runs (boot() above).
// Editor's own "Dashboard" button does a real navigation
// (window.location.href), which reloads this script and refreshes
// cachedCVs — but a phone's native back gesture/button can instead
// restore this page from the browser's back-forward cache (bfcache)
// without re-running any script, silently leaving cachedCVs (and
// therefore what Download uses) stuck on whatever it was BEFORE
// whatever was just edited in the editor. pageshow's event.persisted
// flag is true specifically when a page was restored from bfcache
// rather than freshly loaded; re-running boot() in that case only
// (never on the normal fresh-load path, where it would just be a
// redundant duplicate fetch of what already just ran above).
window.addEventListener('pageshow', (event) => {
  if (event.persisted) boot();
});
