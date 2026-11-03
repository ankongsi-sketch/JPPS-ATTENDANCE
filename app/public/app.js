'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = d => { if (!d) return '—'; const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
  const shortDate = d => d.split('-').reverse().join('/');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const OTHER = '__other__';
  const TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

  const S = {
    cfg: { grades: [], locations: [], orgName: '', hasStaff: false },
    programId: new URLSearchParams(location.search).get('p'),
    program: null, // public view of the program shown on this page
    adminOn: false, full: null, programs: [], records: [], missing: [], seenIds: null,
    status: null, pin: ['', '', '', ''], pinOk: false, view: 'form',
    staff: [], staffFor: null, // staff list, and the program id it was loaded for
    picked: null, guest: false, suggestIdx: -1, suggestions: [],
  };

  async function api(method, url, body, raw) {
    const opts = { method, credentials: 'same-origin' };
    if (raw) { opts.body = raw.body; opts.headers = raw.headers; }
    else if (body) { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    let res;
    try { res = await fetch(url, opts); } catch { return { ok: false, status: 0, data: { error: 'No connection. Please check your internet and try again.' } }; }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && url.startsWith('/api/admin/') && url !== '/api/admin/login') { setAdmin(false); toast('Your admin session has ended. Please log in again.', true); }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  let toastTimer;
  function toast(msg, isError) {
    $('toast-text').textContent = msg;
    $('toast').classList.toggle('is-error', !!isError);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
  }

  // ── Banner ────────────────────────────────────────────────────────────────
  function renderBanner() {
    const p = S.adminOn && S.full ? S.full : S.program;
    if (!p) return;
    $('prog-name').textContent = p.name;
    $('prog-dates').textContent = p.dates || '—';
    $('prog-venue').textContent = p.venue || '—';
    document.title = `${p.name} · Attendance`;
    $('admin-label').textContent = S.adminOn ? 'Exit admin' : 'Admin';
    $('admin-btn').classList.toggle('is-on', S.adminOn);
  }

  // ── Participant ──────────────────────────────────────────────────────────
  const staffMode = () => S.staff.length > 0 && !S.guest;

  function renderParticipant() {
    const p = S.program;
    if (!p) return;
    const closed = p.closed;
    $('closed-panel').hidden = !closed;
    $('form-panel').hidden = closed || S.view !== 'form';
    $('done-panel').hidden = closed || S.view !== 'done';
    const pinOk = S.pinOk || !p.requirePin;
    $('pin-step').hidden = !p.requirePin || S.pinOk;
    $('details').hidden = !pinOk;
    $('reason-field').hidden = S.status !== 'absent';
    document.querySelectorAll('.status-tile').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === S.status)));

    // Name: pick from the staff list, or type details as a guest.
    const sm = staffMode();
    $('name-field').hidden = sm && !!S.picked;
    $('picked').hidden = !(sm && S.picked);
    $('guest-fields').hidden = sm;
    $('dept-field').hidden = !p.askDept;
    $('name-hint').hidden = !sm;
    $('guest-toggle').hidden = !sm;
    $('staff-toggle').hidden = !(S.staff.length && S.guest);
    $('f-name').placeholder = sm ? 'Start typing your name' : 'e.g. Nurul Ain binti Jamil';
    $('f-dept-other').hidden = $('f-dept').value !== OTHER;
    if (sm && S.picked) {
      $('picked-name').textContent = S.picked.name;
      $('picked-tags').innerHTML = [S.picked.grade, p.askDept ? S.picked.location : ''].filter(Boolean).map(t => `<span class="tag tag-outline">${esc(t)}</span>`).join('');
    }
  }

  function buildFormOptions() {
    $('grade-list').innerHTML = S.cfg.grades.map(g => `<option value="${esc(g)}">`).join('');
    $('f-dept').innerHTML = '<option value="">Select location</option>' + S.cfg.locations.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('') + `<option value="${OTHER}">Other agency / office</option>`;
  }

  async function loadStaff() {
    const p = S.program;
    if (!p || !S.cfg.hasStaff || S.staffFor === p.id) return;
    const r = await api('POST', `/api/programs/${p.id}/staff`, { pin: S.pin.join('') });
    if (r.ok && Array.isArray(r.data)) {
      S.staff = r.data.map(s => ({ ...s, key: fold(s.name) }));
      S.staffFor = p.id;
      renderParticipant();
    }
  }

  // Name search: every typed word must appear in the name; word starts rank first.
  function searchStaff(qs) {
    const words = fold(qs).split(' ').filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    for (const s of S.staff) {
      if (!words.every(w => s.key.includes(w))) continue;
      const parts = s.key.split(' ');
      let score = 0;
      words.forEach(w => { if (parts.some(pt => pt.startsWith(w))) score += 2; if (s.key.startsWith(w)) score += 3; });
      scored.push([score, s]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, 8).map(x => x[1]);
  }

  function highlight(name, qs) {
    const words = fold(qs).split(' ').filter(Boolean);
    let html = esc(name);
    words.forEach(w => { html = html.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); });
    return html;
  }

  function renderSuggest() {
    const box = $('name-suggest');
    const qs = $('f-name').value;
    if (!staffMode() || fold(qs).length < 2) { box.hidden = true; $('f-name').setAttribute('aria-expanded', 'false'); return; }
    S.suggestions = searchStaff(qs);
    if (S.suggestIdx >= S.suggestions.length) S.suggestIdx = S.suggestions.length - 1;
    box.innerHTML = S.suggestions.length
      ? S.suggestions.map((s, i) => `<button type="button" class="suggest-item${i === S.suggestIdx ? ' is-active' : ''}" role="option" data-idx="${i}" aria-selected="${i === S.suggestIdx}">
          <span class="s-name">${highlight(s.name, qs)}</span><span class="s-meta">${esc([s.grade, s.location].filter(Boolean).join(' · '))}</span></button>`).join('')
      : '<div class="suggest-empty">No staff found with that name. Check the spelling, or tap "Not on the list?" below.</div>';
    box.hidden = false;
    $('f-name').setAttribute('aria-expanded', 'true');
  }

  function pickStaff(s) {
    S.picked = s; S.suggestIdx = -1;
    $('name-suggest').hidden = true;
    setErr('name', '');
    renderParticipant();
  }

  function setErr(key, msg) {
    const el = $('err-' + key);
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
    const input = { name: $('f-name'), dept: $('f-dept'), grade: $('f-grade') }[key];
    if (input) input.classList.toggle('has-error', !!msg);
  }
  const clearErrs = () => ['status', 'name', 'grade', 'dept', 'form'].forEach(k => setErr(k, ''));

  function pinUI(state, msg) {
    $('pin-boxes').classList.toggle('is-ok', state === 'ok');
    $('pin-boxes').classList.toggle('is-error', state === 'error');
    $('pin-msg').className = 'pin-msg' + (state ? ' is-' + state : '');
    $('pin-msg').textContent = msg || 'Your PIN is given by the secretariat';
  }
  const pinInputs = () => [...document.querySelectorAll('.pin-box')];
  function resetPin(focus) {
    S.pin = ['', '', '', '']; S.pinOk = false;
    pinInputs().forEach(i => { i.value = ''; });
    if (focus) setTimeout(() => pinInputs()[0].focus(), 0);
  }

  async function checkPin() {
    const code = S.pin.join('');
    if (code.length !== 4) return;
    const r = await api('POST', `/api/programs/${S.program.id}/verify-pin`, { pin: code });
    if (r.ok && r.data.ok) {
      S.pinOk = true; pinUI('ok', 'PIN verified');
      toast('PIN verified. Please submit your attendance.');
      renderParticipant();
      await loadStaff();
      $('f-name').focus();
    } else {
      resetPin(true);
      pinUI('error', r.data.error || 'Incorrect PIN. Please ask the secretariat.');
    }
  }

  function wirePin() {
    pinInputs().forEach((inp, i, all) => {
      inp.addEventListener('input', () => {
        const v = inp.value.replace(/\D/g, '').slice(-1);
        inp.value = v; S.pin[i] = v;
        if (v && i < 3) all[i + 1].focus();
        if (S.pin.join('').length === 4) checkPin(); else pinUI(null);
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && i > 0) all[i - 1].focus(); });
      inp.addEventListener('paste', e => {
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
        if (!digits) return;
        e.preventDefault();
        digits.split('').forEach((d, k) => { if (all[k]) { all[k].value = d; S.pin[k] = d; } });
        all[Math.min(digits.length, 3)].focus();
        checkPin();
      });
    });
  }

  async function submit() {
    clearErrs();
    const p = S.program;
    if (staffMode() && !S.picked) {
      setErr('name', $('f-name').value.trim() ? 'Please pick your name from the list, or tap "Not on the list?".' : 'Please type your name and pick it from the list.');
      if (!S.status) setErr('status', 'Please choose Present or Absent.');
      $('f-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const dept = $('f-dept').value === OTHER ? $('f-dept-other').value : $('f-dept').value;
    const body = staffMode()
      ? { status: S.status, pin: S.pin.join(''), staffId: S.picked.id, reason: $('f-reason').value }
      : { status: S.status, pin: S.pin.join(''), name: $('f-name').value, grade: $('f-grade').value, dept, reason: $('f-reason').value };
    const btn = $('submit');
    btn.disabled = true;
    const r = await api('POST', `/api/programs/${p.id}/records`, body).finally(() => { btn.disabled = false; });
    if (r.status === 400 && r.data.errors) {
      Object.entries(r.data.errors).forEach(([k, v]) => setErr(k, v));
      if (r.data.errors.name && S.picked) { S.picked = null; renderParticipant(); setErr('name', r.data.errors.name); }
      const first = ['status', 'name', 'grade', 'dept'].find(k => r.data.errors[k]);
      ({ status: $('status-tiles'), name: $('name-field'), grade: $('f-grade'), dept: $('f-dept') })[first]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (r.status === 403 && r.data.field === 'pin') { resetPin(true); pinUI('error', r.data.error); renderParticipant(); return; }
    if (r.status === 409) { await loadProgram(); toast(r.data.error, true); return; }
    if (!r.ok) { setErr('form', r.data.error || 'Something went wrong. Please try again.'); return; }

    const who = staffMode() ? S.picked : { name: body.name.trim().replace(/\s+/g, ' '), grade: body.grade.trim().toUpperCase(), location: dept.trim() };
    const rows = [['Name', who.name], ['Status', S.status === 'present' ? 'Present' : 'Absent'], ['Grade', who.grade]];
    if (p.askDept) rows.push(['Location', who.location]);
    if (S.status === 'absent' && body.reason.trim()) rows.push(['Reason', body.reason.trim()]);
    rows.push(['Date', fmtDate(r.data.date)], ['Time', r.data.time]);
    $('done-summary').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('');
    resetForm();
    S.view = 'done';
    renderParticipant();
    toast('Attendance submitted successfully!');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (S.adminOn) refreshAdmin();
  }

  function resetForm() {
    S.status = null; S.picked = null; S.guest = false; S.suggestIdx = -1;
    ['f-name', 'f-grade', 'f-dept', 'f-dept-other', 'f-reason'].forEach(id => { $(id).value = ''; });
    $('name-suggest').hidden = true;
    resetPin(false); pinUI(null); clearErrs();
  }

  // ── Admin ────────────────────────────────────────────────────────────────
  function setAdmin(on) {
    S.adminOn = on;
    ['admin-panel', 'history-panel', 'staff-panel', 'analysis-panel'].forEach(id => { $(id).hidden = !on; });
    clearInterval(S.poll);
    if (on) { S.seenIds = null; refreshAdmin(); refreshStaffInfo(); S.poll = setInterval(() => { if (!document.hidden) refreshAdmin(); }, 5000); }
    renderBanner();
  }

  async function refreshAdmin() {
    if (!S.program) return;
    const id = S.program.id;
    const [full, list, recs, missing] = await Promise.all([
      api('GET', `/api/admin/programs/${id}`), api('GET', '/api/admin/programs'),
      api('GET', `/api/admin/programs/${id}/records`), api('GET', `/api/admin/programs/${id}/missing`),
    ]);
    if (!S.adminOn || id !== S.program.id) return;
    if (full.ok) { const first = !S.full || S.full.id !== full.data.id; S.full = full.data; S.program = { ...S.program, ...full.data }; renderAdminFields(first); renderParticipant(); }
    if (list.ok) { S.programs = list.data; renderHistory(); }
    if (missing.ok) S.missing = missing.data;
    if (recs.ok) { S.records = recs.data; renderAnalysis(); }
    renderBanner();
  }

  async function refreshStaffInfo() {
    const r = await api('GET', '/api/admin/staff');
    if (!r.ok) return;
    const { count, fileName, updatedAt } = r.data;
    $('staff-count').textContent = `${count} staff`;
    $('staff-info').textContent = count
      ? `Participants pick their name from this list. Updated ${new Date(updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${fileName ? ` from ${fileName}` : ''}.`
      : 'No staff list uploaded. Participants type their own name, grade and location.';
    $('staff-upload-label').textContent = count ? 'Upload a newer PERJAWATAN (.xlsx)' : 'Upload PERJAWATAN (.xlsx)';
  }

  function renderAdminFields(fillInputs) {
    const p = S.full;
    if (fillInputs) {
      $('a-name').value = p.name; $('a-dates').value = p.dates; $('a-venue').value = p.venue; $('a-pin').value = p.pin;
      const src = `/api/admin/programs/${p.id}/qr.svg?v=${Date.now()}`;
      $('qr-small').src = src; $('qr-large').src = src; $('qr-download').href = src;
      $('csv-link').href = `/api/admin/programs/${p.id}/export.csv`;
      api('GET', `/api/admin/programs/${p.id}/link`).then(r => { if (r.ok) { $('qr-url').href = r.data.url; $('qr-url').textContent = r.data.url; } });
    }
    $('a-require-pin').checked = p.requirePin;
    $('a-ask-dept').checked = p.askDept;
    $('closed-label').textContent = p.closed ? 'Reopen form' : 'Close form';
    $('current-tag-wrap').innerHTML = p.active ? '<span class="tag tag-accent">Current program · opens at the main link</span>' : '';
    $('set-current').disabled = p.active;
    $('set-current').textContent = p.active ? 'Current program ✓' : 'Set as current';
    $('qr-title').textContent = p.name;
  }

  function renderHistory() {
    $('h-count').textContent = S.programs.length;
    $('h-total').textContent = S.programs.reduce((t, p) => t + p.present + p.absent, 0);
    $('program-list').innerHTML = S.programs.map(p => `
      <button type="button" class="blueprint program-item${p.id === S.program.id ? ' is-selected' : ''}" data-id="${p.id}">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="row-between"><span class="p-meta">${esc(p.dates || 'No dates set')}</span>
          <span class="tags">${p.active ? '<span class="tag tag-accent">Current</span>' : ''}${p.closed ? '<span class="tag tag-neutral">Closed</span>' : ''}</span></div>
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-count">${p.present} present · ${p.absent} absent · ${esc(p.venue || 'No venue set')}</span>
      </button>`).join('');
  }

  function renderAnalysis() {
    const recs = S.records;
    const present = recs.filter(r => r.status === 'present').length;
    $('present-n').textContent = present;
    $('absent-n').textContent = recs.length - present;
    $('recs-empty').hidden = recs.length > 0;
    const fresh = S.seenIds ? recs.filter(r => !S.seenIds.has(r.id)).map(r => r.id) : [];
    S.seenIds = new Set(recs.map(r => r.id));
    $('rec-list').innerHTML = [...recs].reverse().map(r => `
      <div class="rec${fresh.includes(r.id) ? ' is-new' : ''}" data-id="${r.id}">
        <div class="rec-main">
          <span class="rec-name">${esc(r.name)}</span>
          <div class="rec-sub"><span class="tag ${r.status === 'present' ? 'tag-accent-2' : 'tag-neutral'}">${r.status === 'present' ? 'Present' : 'Absent'}</span>
            <span class="rec-meta">${esc([r.grade, r.dept, r.reason].filter(Boolean).join(' · '))}</span></div>
        </div>
        <div class="rec-when"><span>${shortDate(r.date)}</span><b>${esc(r.time)}</b></div>
        <button type="button" class="btn btn-icon" data-delete="${r.id}" title="Delete record" aria-label="Delete record for ${esc(r.name)}">${TRASH}</button>
      </div>`).join('');
    if (fresh.length) setTimeout(() => document.querySelectorAll('.rec.is-new').forEach(el => el.classList.remove('is-new')), 2600);

    const hasStaff = S.cfg.hasStaff;
    $('missing-box').hidden = !hasStaff;
    $('missing-details').hidden = !hasStaff || !S.missing.length;
    $('missing-n').textContent = S.missing.length;
    $('missing-n2').textContent = S.missing.length;
    $('missing-list').innerHTML = S.missing.map(s => `<div class="missing-row"><span>${esc(s.name)}</span><span>${esc([s.grade, s.location].filter(Boolean).join(' · '))}</span></div>`).join('');
  }

  async function patchProgram(changes, msg) {
    const r = await api('PATCH', `/api/admin/programs/${S.full.id}`, changes);
    if (!r.ok) { toast(r.data.error || 'Could not save.', true); renderAdminFields(true); return; }
    S.full = r.data;
    S.program = { ...S.program, ...r.data };
    renderAdminFields(false); renderBanner(); renderParticipant();
    if (msg) toast(msg);
    api('GET', '/api/admin/programs').then(l => { if (l.ok) { S.programs = l.data; renderHistory(); } });
  }

  async function openProgram(id) {
    S.programId = String(id);
    history.replaceState(null, '', `?p=${id}`);
    S.full = null; S.view = 'form'; resetForm();
    await loadProgram();
    if (S.adminOn) { S.seenIds = null; refreshAdmin(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function copyExcel() {
    const p = S.full;
    const rows = [[p.name], ['No', 'Name', 'Grade', 'Location', 'Status', 'Reason', 'Date', 'Time']];
    S.records.forEach((r, i) => rows.push([i + 1, r.name, r.grade, r.dept, r.status === 'present' ? 'Present' : 'Absent', r.reason, fmtDate(r.date), r.time]));
    if (S.cfg.hasStaff && S.missing.length) {
      rows.push([], [`Staff not yet recorded (${S.missing.length})`], ['No', 'Name', 'Grade', 'Location']);
      S.missing.forEach((s, i) => rows.push([i + 1, s.name, s.grade, s.location]));
    }
    const tsv = rows.map(r => r.map(c => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    const done = () => toast('Copied. Paste into Excel.');
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(tsv).then(done, fallback); else fallback();
  }

  function printReport() {
    const p = S.full, recs = S.records;
    const present = recs.filter(r => r.status === 'present').length;
    const rows = recs.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.grade)}</td><td>${esc(r.dept)}</td><td>${r.status === 'present' ? 'Present' : 'Absent'}</td><td>${esc(r.reason)}</td><td>${esc(shortDate(r.date))}</td><td>${esc(r.time)}</td></tr>`).join('');
    const showMissing = S.cfg.hasStaff && S.missing.length;
    const missing = showMissing ? `<h2>Staff not yet recorded (${S.missing.length})</h2><table><tr><th>No</th><th>Name</th><th>Grade</th><th>Location</th></tr>${S.missing.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.grade)}</td><td>${esc(s.location)}</td></tr>`).join('')}</table>` : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Attendance report · ${esc(p.name)}</title><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500&family=Barlow+Condensed:wght@600&display=swap" rel="stylesheet"><style>body{font:11pt/1.45 Barlow,sans-serif;margin:20mm 18mm;color:#1d1f20}h1{font:600 20pt/1.15 'Barlow Condensed';margin:14pt 0 6pt}h2{font:600 14pt 'Barlow Condensed';margin:20pt 0 0;break-before:auto}.org{display:flex;align-items:center;gap:10pt;font:600 14pt 'Barlow Condensed';border-bottom:1.5px solid #1d1f20;padding-bottom:8pt}.org img{width:40pt;height:40pt;object-fit:contain}.org small{display:block;font:400 9pt Barlow;color:#5d5d60}p{margin:0 0 2pt}table{width:100%;border-collapse:collapse;margin-top:10pt}th{text-align:left;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#5d5d60;border-bottom:1px solid #999;padding:5pt}td{padding:6pt 5pt;border-bottom:1px solid #ddd}tr{break-inside:avoid}.foot{margin-top:18pt;font-size:8pt;color:#5d5d60}</style></head><body><div class="org"><img src="${location.origin}/assets/jpps-logo.png" alt=""><div>${esc(S.cfg.orgName)}<small>Attendance report</small></div></div><h1>${esc(p.name)}</h1><p>Program dates: ${esc(p.dates || '—')}</p><p>Venue: ${esc(p.venue || '—')}</p><p><b>Present: ${present} · Absent: ${recs.length - present}${showMissing ? ` · Not yet recorded: ${S.missing.length}` : ''}</b></p><table><tr><th>No</th><th>Name</th><th>Grade</th><th>Location</th><th>Status</th><th>Reason</th><th>Date</th><th>Time</th></tr>${rows}</table>${missing}<p class="foot">Generated ${esc(new Date().toLocaleString('en-GB'))}</p></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Please allow pop-ups to save the PDF.', true); return; }
    w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 700);
  }

  async function uploadStaff(file) {
    if (!file) return;
    $('staff-upload-label').textContent = 'Uploading…';
    const r = await api('POST', '/api/admin/staff', null, { body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
    $('staff-file').value = '';
    if (!r.ok) { toast(r.data.error || 'Upload failed.', true); refreshStaffInfo(); return; }
    toast(`Staff list updated: ${r.data.count} staff.`);
    S.cfg.hasStaff = r.data.count > 0; S.staffFor = null;
    const cfg = await api('GET', '/api/config'); if (cfg.ok) { S.cfg = cfg.data; buildFormOptions(); }
    refreshStaffInfo(); refreshAdmin(); loadStaff();
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  async function loadProgram() {
    const r = await api('GET', '/api/program' + (S.programId ? `?p=${encodeURIComponent(S.programId)}` : ''));
    if (!r.ok) {
      $('load-error').textContent = r.data.error === 'Program not found.' ? 'This attendance link is no longer valid. Please scan the QR code again or ask the secretariat.' : 'Could not load the program. Please check your connection and reload.';
      $('load-error').hidden = false;
      ['form-panel', 'done-panel', 'closed-panel'].forEach(id => { $(id).hidden = true; });
      return false;
    }
    $('load-error').hidden = true;
    if (S.program && S.program.id !== r.data.id) { S.staff = []; S.staffFor = null; }
    S.program = r.data;
    renderBanner(); renderParticipant();
    if (!S.program.requirePin || S.pinOk) loadStaff();
    return true;
  }

  function wire() {
    wirePin();
    $('status-tiles').addEventListener('click', e => {
      const b = e.target.closest('.status-tile'); if (!b) return;
      S.status = b.dataset.status; setErr('status', ''); renderParticipant();
    });

    // Name picker
    $('f-name').addEventListener('input', () => { setErr('name', ''); S.suggestIdx = 0; renderSuggest(); });
    $('f-name').addEventListener('focus', renderSuggest);
    $('f-name').addEventListener('blur', () => setTimeout(() => { $('name-suggest').hidden = true; $('f-name').setAttribute('aria-expanded', 'false'); }, 150));
    $('f-name').addEventListener('keydown', e => {
      if ($('name-suggest').hidden || !S.suggestions.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = S.suggestions.length;
        S.suggestIdx = ((S.suggestIdx < 0 ? -1 : S.suggestIdx) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        renderSuggest();
      } else if (e.key === 'Enter' && S.suggestIdx >= 0) { e.preventDefault(); pickStaff(S.suggestions[S.suggestIdx]); }
      else if (e.key === 'Escape') { $('name-suggest').hidden = true; }
    });
    $('name-suggest').addEventListener('mousedown', e => e.preventDefault()); // keep focus so the click lands
    $('name-suggest').addEventListener('click', e => { const b = e.target.closest('.suggest-item'); if (b) pickStaff(S.suggestions[Number(b.dataset.idx)]); });
    $('picked-change').addEventListener('click', () => { S.picked = null; renderParticipant(); $('f-name').focus(); $('f-name').select(); });
    $('guest-toggle').addEventListener('click', () => { S.guest = true; S.picked = null; $('name-suggest').hidden = true; clearErrs(); renderParticipant(); $('f-name').focus(); });
    $('staff-toggle').addEventListener('click', () => { S.guest = false; clearErrs(); renderParticipant(); $('f-name').focus(); });
    $('f-grade').addEventListener('input', () => setErr('grade', ''));
    $('f-dept').addEventListener('change', () => { setErr('dept', ''); renderParticipant(); if ($('f-dept').value === OTHER) $('f-dept-other').focus(); });
    $('f-dept-other').addEventListener('input', () => setErr('dept', ''));
    $('submit').addEventListener('click', submit);
    $('done-again').addEventListener('click', () => { S.view = 'form'; renderParticipant(); });

    $('admin-btn').addEventListener('click', async () => {
      if (S.adminOn) { await api('POST', '/api/admin/logout'); S.full = null; setAdmin(false); toast('Logged out of admin.'); return; }
      const me = await api('GET', '/api/admin/me');
      if (me.data.admin) return setAdmin(true);
      $('login-err').hidden = true; $('login-pass').value = '';
      $('login-dialog').hidden = false; $('login-pass').focus();
    });
    $('login-cancel').addEventListener('click', () => { $('login-dialog').hidden = true; });
    $('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await api('POST', '/api/admin/login', { password: $('login-pass').value });
      if (!r.ok) { $('login-err').textContent = r.data.error || 'Login failed.'; $('login-err').hidden = false; return; }
      $('login-dialog').hidden = true; setAdmin(true); window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Admin fields: live-update the banner while typing, save on change.
    ['a-name', 'a-dates', 'a-venue'].forEach(id => {
      $(id).addEventListener('input', () => { S.full[$(id).dataset.key] = $(id).value; renderBanner(); });
      $(id).addEventListener('change', () => patchProgram({ [$(id).dataset.key]: $(id).value }, 'Saved.'));
    });
    $('a-pin').addEventListener('input', () => { $('a-pin').value = $('a-pin').value.replace(/\D/g, '').slice(0, 4); });
    $('a-pin').addEventListener('change', () => patchProgram({ pin: $('a-pin').value }, 'PIN updated.'));
    $('a-require-pin').addEventListener('change', e => patchProgram({ requirePin: e.target.checked }, e.target.checked ? 'PIN required.' : 'PIN step turned off.'));
    $('a-ask-dept').addEventListener('change', e => patchProgram({ askDept: e.target.checked }, e.target.checked ? 'Location question on.' : 'Location question off.'));
    $('toggle-closed').addEventListener('click', () => { const c = !S.full.closed; patchProgram({ closed: c }, c ? 'Form closed. No new submissions.' : 'Form reopened.'); });
    $('pdf-report').addEventListener('click', printReport);
    $('copy-excel').addEventListener('click', copyExcel);
    $('staff-file').addEventListener('change', e => uploadStaff(e.target.files[0]));
    $('set-current').addEventListener('click', async () => {
      const r = await api('POST', `/api/admin/programs/${S.full.id}/activate`);
      if (r.ok) { toast('This program now opens at the main link.'); refreshAdmin(); }
    });
    $('delete-program').addEventListener('click', async () => {
      const n = S.records.length;
      if (!confirm(`Delete "${S.full.name}"${n ? ` and its ${n} record${n === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
      const r = await api('DELETE', `/api/admin/programs/${S.full.id}`);
      if (r.ok) { toast('Program deleted.'); S.programId = null; history.replaceState(null, '', location.pathname); S.full = null; await loadProgram(); refreshAdmin(); }
    });
    $('new-program').addEventListener('click', async () => {
      const r = await api('POST', '/api/admin/programs');
      if (r.ok) { await openProgram(r.data.id); toast('New program created. Rename it above.'); setTimeout(() => { $('a-name').focus(); $('a-name').select(); }, 300); }
    });
    $('program-list').addEventListener('click', e => { const b = e.target.closest('.program-item'); if (b) openProgram(b.dataset.id); });
    $('rec-list').addEventListener('click', async e => {
      const b = e.target.closest('[data-delete]'); if (!b) return;
      const rec = S.records.find(r => String(r.id) === b.dataset.delete);
      if (!confirm(`Delete the record for ${rec?.name || 'this person'}?`)) return;
      const r = await api('DELETE', `/api/admin/records/${b.dataset.delete}`);
      if (r.ok) { toast('Record deleted.'); refreshAdmin(); }
    });
    $('qr-open').addEventListener('click', () => { $('qr-dialog').hidden = false; });
    $('qr-close').addEventListener('click', () => { $('qr-dialog').hidden = true; });
    document.querySelectorAll('.dialog-backdrop').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.hidden = true; }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.dialog-backdrop').forEach(d => { d.hidden = true; }); });
  }

  async function init() {
    wire();
    const cfg = await api('GET', '/api/config');
    if (cfg.ok) {
      S.cfg = cfg.data;
      $('org-name').innerHTML = S.cfg.orgNameLines.map(esc).join('<br>');
    }
    buildFormOptions();
    if (!(await loadProgram())) return;
    const me = await api('GET', '/api/admin/me');
    if (me.data.admin) setAdmin(true);
  }
  init();
})();
