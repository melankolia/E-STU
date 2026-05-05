/* =========================================================
   Cimanggis Reservation — App Logic
   ========================================================= */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- State ---------------- */
  const state = {
    step: 1,
    form: { name: '', email: '', whatsapp: '', unit: '', date: '', time: '' },
    today: startOfDay(new Date()),
    cursor: startOfDay(new Date()),       // calendar cursor (1st of visible month)
    bookings: [],                          // [{jadwal, status}]
    bookingsLoaded: false,
    bookingsLoading: false
  };
  state.cursor = new Date(state.today.getFullYear(), state.today.getMonth(), 1);

  /* ---------------- Slot rules (mirror backend) ---------------- */
  function getValidSlots(day) {
    if (day >= 1 && day <= 4) return ['09:00', '10:00', '13:00', '14:00', '15:00'];
    if (day === 5) return ['11:00', '12:00', '13:00', '14:00'];
    if (day === 6) return ['09:00', '10:00', '11:00', '12:00'];
    return [];
  }

  function capacityFor(day) {
    const c = (CFG.CAPACITY_BY_DAY || {})[day];
    return (c === null || c === undefined) ? Infinity : c;
  }

  /* ---------------- Init ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('#year').textContent = new Date().getFullYear();
    bindNav();
    bindForm();
    bindCalendarNav();
    fetchBookings();
    renderCalendar();
  });

  /* ---------------- Step navigation ---------------- */
  function bindNav() {
    $$('[data-next]').forEach(btn => btn.addEventListener('click', () => {
      const next = Number(btn.dataset.next);
      if (next === 2 && !validateStep1()) return;
      if (next === 3 && !state.form.date) return;
      if (next === 4) {
        if (!state.form.time) return;
        renderReview();
      }
      goStep(next);
    }));

    $$('[data-prev]').forEach(btn => btn.addEventListener('click', () => {
      goStep(Number(btn.dataset.prev));
    }));

    $('#agree').addEventListener('change', e => {
      $('#submitBtn').disabled = !e.target.checked;
    });

    $('#bookAnother').addEventListener('click', resetAll);
  }

  function goStep(n) {
    state.step = n;
    $$('.panel').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.panel) === n);
    });
    $$('.step').forEach(s => {
      const i = Number(s.dataset.step);
      s.classList.toggle('is-active', i === n);
      s.classList.toggle('is-done', i < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Step 1: validation ---------------- */
  function bindForm() {
    ['name', 'email', 'whatsapp', 'unit'].forEach(k => {
      const el = $('#' + k);
      el.addEventListener('input', () => {
        state.form[k] = el.value.trim();
        clearError(k);
      });
      el.addEventListener('blur', () => validateField(k));
    });

    $('#bookingForm').addEventListener('submit', onSubmit);
  }

  function validateStep1() {
    const fields = ['name', 'email', 'whatsapp', 'unit'];
    let ok = true;
    fields.forEach(k => { if (!validateField(k)) ok = false; });
    if (!ok) toast('Lengkapi data diri terlebih dahulu', 'error');
    return ok;
  }

  function validateField(key) {
    const el = $('#' + key);
    const val = el.value.trim();
    let err = '';

    if (!val) {
      err = 'Wajib diisi';
    } else if (key === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) err = 'Format email tidak valid';
    } else if (key === 'whatsapp') {
      const digits = val.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15) err = 'Nomor tidak valid';
    } else if (key === 'name') {
      if (val.length < 2) err = 'Nama terlalu pendek';
    }

    setError(key, err);
    return !err;
  }

  function setError(key, msg) {
    const el = $('#' + key);
    const hint = $(`[data-error-for="${key}"]`);
    el.parentElement.classList.toggle('has-error', !!msg);
    if (hint) hint.textContent = msg || '';
  }

  function clearError(key) { setError(key, ''); }

  /* ---------------- Calendar ---------------- */
  function bindCalendarNav() {
    $('#prevMonth').addEventListener('click', () => moveMonth(-1));
    $('#nextMonth').addEventListener('click', () => moveMonth(1));
  }

  function moveMonth(delta) {
    const c = state.cursor;
    const next = new Date(c.getFullYear(), c.getMonth() + delta, 1);
    const lower = new Date(state.today.getFullYear(), state.today.getMonth(), 1);
    const upper = addDays(state.today, CFG.MAX_DAYS_AHEAD || 60);
    if (next < lower) return;
    if (next > upper) return;
    state.cursor = next;
    renderCalendar();
  }

  function renderCalendar() {
    const c = state.cursor;
    const monthName = c.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    $('#calTitle').textContent = capitalize(monthName);

    const grid = $('#calGrid');
    grid.innerHTML = '';

    // First day of month — start grid on Monday
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const daysInMonth = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();

    // Empty leading cells
    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'day is-empty';
      grid.appendChild(empty);
    }

    const upper = addDays(state.today, CFG.MAX_DAYS_AHEAD || 60);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(c.getFullYear(), c.getMonth(), d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = d;

      const dayOfWeek = date.getDay(); // 0=Sun .. 6=Sat
      const iso = isoDate(date);
      const isPast = date < state.today;
      const isFuture = date > upper;
      const isClosed = dayOfWeek === 0; // Sunday closed

      const slots = getValidSlots(dayOfWeek);
      const status = dayAvailability(iso, dayOfWeek);

      if (sameDay(date, state.today)) btn.classList.add('is-today');

      if (isPast || isClosed || isFuture || slots.length === 0 || status.full) {
        btn.disabled = true;
        if (status.full && !isPast && !isClosed) {
          const b = document.createElement('span');
          b.className = 'day__badge full';
          b.textContent = 'Penuh';
          btn.appendChild(b);
        }
      } else if (status.soon) {
        const b = document.createElement('span');
        b.className = 'day__badge soon';
        b.textContent = 'Sisa ' + status.remaining;
        btn.appendChild(b);
      }

      if (state.form.date === iso) btn.classList.add('is-selected');

      btn.addEventListener('click', () => selectDate(iso, date));
      grid.appendChild(btn);
    }

    // Disable arrows at boundaries
    const lower = new Date(state.today.getFullYear(), state.today.getMonth(), 1);
    $('#prevMonth').disabled = c <= lower;
    const nextCursor = new Date(c.getFullYear(), c.getMonth() + 1, 1);
    $('#nextMonth').disabled = nextCursor > upper;
  }

  function dayAvailability(iso, dayOfWeek) {
    const slots = getValidSlots(dayOfWeek);
    if (slots.length === 0) return { full: true, soon: false, remaining: 0 };
    const cap = capacityFor(dayOfWeek);
    if (cap === Infinity) return { full: false, soon: false, remaining: Infinity };

    let totalBooked = 0;
    let totalCapacity = slots.length * cap;
    slots.forEach(t => {
      const key = `${iso} ${t}`;
      const c = countBooked(key);
      totalBooked += Math.min(c, cap);
    });
    const remaining = totalCapacity - totalBooked;
    return {
      full: remaining <= 0,
      soon: remaining > 0 && remaining <= Math.max(1, Math.floor(totalCapacity * 0.34)),
      remaining
    };
  }

  function countBooked(rawJadwal) {
    if (!state.bookings.length) return 0;
    let n = 0;
    for (const b of state.bookings) {
      if (b.status === 'Hadir' && b.jadwal === rawJadwal) n++;
    }
    return n;
  }

  function selectDate(iso, dateObj) {
    state.form.date = iso;
    state.form.time = '';
    renderCalendar();
    $('#toStep3').disabled = false;
    $('#dateSummary').textContent = humanDate(dateObj);
    renderSlots(dateObj);
  }

  /* ---------------- Time slots ---------------- */
  function renderSlots(dateObj) {
    const wrap = $('#slotsWrap');
    wrap.innerHTML = '';
    const dayOfWeek = dateObj.getDay();
    const slots = getValidSlots(dayOfWeek);
    const cap = capacityFor(dayOfWeek);
    const iso = isoDate(dateObj);

    if (!slots.length) {
      wrap.innerHTML = `<div class="slots__empty">Tidak ada layanan pada hari ini.</div>`;
      $('#toStep4').disabled = true;
      return;
    }

    const now = new Date();
    const isToday = sameDay(dateObj, state.today);

    slots.forEach(t => {
      const key = `${iso} ${t}`;
      const booked = countBooked(key);
      const remaining = cap === Infinity ? Infinity : cap - booked;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot';
      btn.dataset.time = t;

      const [h] = t.split(':');
      const endH = String(Number(h) + 1).padStart(2, '0');

      const past = isToday && timeIsPast(now, t);
      const full = remaining <= 0;
      const disabled = past || full;

      btn.innerHTML = `
        <span class="slot__time">${h}.00 – ${endH}.00</span>
        <span class="slot__meta">${past ? 'Telah lewat' : full ? 'Slot penuh' : (cap === Infinity ? 'Tersedia' : `Sisa ${remaining} slot`)}</span>
      `;
      if (disabled) btn.disabled = true;

      btn.addEventListener('click', () => {
        if (disabled) return;
        state.form.time = t;
        $$('.slot', wrap).forEach(b => b.classList.toggle('is-selected', b === btn));
        $('#toStep4').disabled = false;
      });

      wrap.appendChild(btn);
    });

    $('#toStep4').disabled = !state.form.time;
  }

  function timeIsPast(now, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    return t.getTime() <= now.getTime();
  }

  /* ---------------- Review ---------------- */
  function renderReview() {
    const f = state.form;
    const dateObj = parseISO(f.date);
    const display = formatDisplay(dateObj, f.time);
    const phone = formatPhone(f.whatsapp);

    $('#review').innerHTML = `
      <dt>Nama</dt><dd>${escapeHtml(f.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(f.email)}</dd>
      <dt>WhatsApp</dt><dd>${escapeHtml(phone)}</dd>
      <dt>Unit / Blok</dt><dd>${escapeHtml(f.unit)}</dd>
      <dt>Jadwal</dt><dd>${escapeHtml(display)}</dd>
    `;
    $('#agree').checked = false;
    $('#submitBtn').disabled = true;
  }

  /* ---------------- Submit ---------------- */
  async function onSubmit(e) {
    e.preventDefault();
    if (!$('#agree').checked) return;

    const btn = $('#submitBtn');
    btn.classList.add('is-loading');
    btn.disabled = true;

    if (!isApiConfigured()) {
      btn.classList.remove('is-loading'); btn.disabled = false;
      toast('API URL belum dikonfigurasi pada config.js', 'error', 5000);
      return;
    }

    try {
      const f = state.form;
      const params = new URLSearchParams({
        name: f.name,
        whatsapp: f.whatsapp,
        unit: f.unit,
        date: f.date,
        time: f.time,
        email: f.email
      });

      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: params,
        redirect: 'follow'
      });
      const json = await safeJson(res);

      if (!json || json.success === false) {
        const msg = (json && json.message) || 'Gagal mengirim reservasi.';
        toast(msg, 'error', 4500);
        btn.classList.remove('is-loading'); btn.disabled = false;
        return;
      }

      showSuccess(json);
      // refresh list silently
      fetchBookings();
    } catch (err) {
      toast('Tidak dapat terhubung ke server. Coba lagi.', 'error');
      btn.classList.remove('is-loading'); btn.disabled = false;
    }
  }

  function showSuccess(json) {
    const f = state.form;
    const dateObj = parseISO(f.date);
    const display = formatDisplay(dateObj, f.time);

    $('#successTitle').textContent = json.message && json.message.toLowerCase().includes('reschedule')
      ? 'Reschedule Jadwal Berhasil'
      : 'Konfirmasi Berhasil Dikirim';
    $('#successMsg').textContent = 'Jadwal serah terima unit Anda telah tercatat. Mohon hadir tepat waktu sesuai jadwal yang dipilih.';
    $('#successReview').innerHTML = `
      <dt>Nama</dt><dd>${escapeHtml(f.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(f.email)}</dd>
      <dt>WhatsApp</dt><dd>${escapeHtml(formatPhone(f.whatsapp))}</dd>
      <dt>Unit / Blok</dt><dd>${escapeHtml(f.unit)}</dd>
      <dt>Jadwal</dt><dd>${escapeHtml(display)}</dd>
    `;
    $('#bookingForm').hidden = true;
    $('.stepper').style.display = 'none';
    $('#successCard').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetAll() {
    state.form = { name: '', email: '', whatsapp: '', unit: '', date: '', time: '' };
    ['name', 'email', 'whatsapp', 'unit'].forEach(k => { $('#' + k).value = ''; clearError(k); });
    $('#successCard').hidden = true;
    $('#bookingForm').hidden = false;
    $('.stepper').style.display = '';
    $('#submitBtn').classList.remove('is-loading');
    $('#submitBtn').disabled = true;
    $('#toStep3').disabled = true;
    $('#toStep4').disabled = true;
    $('#dateSummary').textContent = '';
    $('#slotsWrap').innerHTML = '';
    goStep(1);
    renderCalendar();
  }

  /* ---------------- Fetch bookings ---------------- */
  async function fetchBookings() {
    if (!isApiConfigured()) return;
    if (state.bookingsLoading) return;
    state.bookingsLoading = true;
    try {
      const res = await fetch(CFG.API_URL, { method: 'GET', redirect: 'follow' });
      const json = await safeJson(res);
      if (Array.isArray(json)) {
        // Normalize jadwal: Google Sheets may serialize Date objects as ISO UTC strings.
        // Convert to "YYYY-MM-DD HH:mm" in WIB (UTC+7) to match slot comparison keys.
        state.bookings = json
          .filter(b => b && typeof b === 'object' && b.jadwal && String(b.jadwal).trim() && b.status && String(b.status).trim())
          .map(b => ({ jadwal: normalizeJadwal(b.jadwal), status: String(b.status).trim() }))
          .filter(b => b.jadwal !== null);
        state.bookingsLoaded = true;
        renderCalendar();
        if (state.form.date) renderSlots(parseISO(state.form.date));
      }
    } catch (_) { /* offline ok */ }
    finally { state.bookingsLoading = false; }
  }

  /* Normalizes jadwal from the API into "YYYY-MM-DD HH:mm" in WIB.
     Handles two formats emitted by GAS:
       - "YYYY-MM-DD HH:mm"      → string stored directly in Sheets
       - "YYYY-MM-DDTHH:mm:ss.sssZ" → Date object serialized as UTC ISO by GAS */
  function normalizeJadwal(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // Already in expected "YYYY-MM-DD HH:mm" format
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s;

    // ISO UTC string from Sheets Date object → shift to WIB (UTC+7)
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;

    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const yr  = wib.getUTCFullYear();
    const mo  = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dy  = String(wib.getUTCDate()).padStart(2, '0');
    const hr  = String(wib.getUTCHours()).padStart(2, '0');
    const mn  = String(wib.getUTCMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${hr}:${mn}`;
  }

  function isApiConfigured() {
    return CFG.API_URL && !/REPLACE_WITH_YOUR_DEPLOYMENT_ID/.test(CFG.API_URL);
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, type = '', duration = 3200) {
    const el = $('#toast');
    el.className = 'toast' + (type ? ' is-' + type : '');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => { el.hidden = true; }, 250);
    }, duration);
  }

  /* ---------------- Helpers ---------------- */
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function isoDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function humanDate(d) {
    const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
    const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${capitalize(hari)}, ${tgl}`;
  }
  function formatDisplay(d, time) {
    const hari = capitalize(d.toLocaleDateString('id-ID', { weekday: 'long' }));
    const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const [h] = time.split(':');
    const eh = String(Number(h) + 1).padStart(2, '0');
    return `${hari}, ${tgl} — ${h}.00–${eh}.00`;
  }
  function formatPhone(n) {
    const digits = String(n).replace(/\D/g, '');
    if (!digits) return n;
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  async function safeJson(res) {
    try { return await res.json(); }
    catch {
      try { const t = await res.text(); return JSON.parse(t); }
      catch { return null; }
    }
  }
})();
