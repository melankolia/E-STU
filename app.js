/* =========================================================
   Cimanggis Reservation — App Logic
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- State ---------------- */
  const state = {
    step: 1,
    form: { name: "", email: "", whatsapp: "", unit: "", date: "", time: "", type: "" },
    today: startOfDay(new Date()),
    cursor: startOfDay(new Date()), // calendar cursor (1st of visible month)
    bookings: [], // [{jadwal, status}] — fallback bila backend belum punya ?action=availability
    availability: null, // { "YYYY-MM-DD": { "HH:mm": sisa } } dari backend
    bookingsLoaded: false,
    bookingsLoading: false,
  };
  state.cursor = new Date(state.today.getFullYear(), state.today.getMonth(), 1);

  /* ---------------- Slot rules (mirror backend) ---------------- */
  function getValidSlots(day) {
    if (day >= 1 && day <= 4)
      return ["09:00", "10:00", "13:00", "14:00"];
    if (day === 5) return ["09:00", "10:00", "14:00"];
    if (day === 6) return ["10:00"]; // Khusus Re-Schedule
    return [];
  }

  function capacityFor(day) {
    const c = (CFG.CAPACITY_BY_DAY || {})[day];
    return c === null || c === undefined ? Infinity : c;
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    $("#year").textContent = new Date().getFullYear();
    bindNav();
    bindForm();
    bindCalendarNav();
    fetchBookings();
    renderCalendar();
  });

  /* ---------------- Step navigation ---------------- */
  function bindNav() {
    $$("[data-next]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const next = Number(btn.dataset.next);
        if (next === 2 && !validateStep1()) return;
        if (next === 3 && !state.form.date) return;
        if (next === 4) {
          if (!state.form.date || !state.form.time) {
            toast("Pilih jadwal dan waktu terlebih dahulu", "error");
            return;
          }
          renderReview();
        }
        goStep(next);
        if (next === 2) renderCalendar();
      }),
    );

    $$("[data-prev]").forEach((btn) =>
      btn.addEventListener("click", () => {
        goStep(Number(btn.dataset.prev));
      }),
    );

    $("#agree").addEventListener("change", (e) => {
      $("#submitBtn").disabled = !e.target.checked;
    });

    $("#bookAnother").addEventListener("click", resetAll);
    $("#saveTicket").addEventListener("click", saveTicket);
    $("#shareTicket").addEventListener("click", shareTicket);
  }

  function goStep(n) {
    state.step = n;
    $$(".panel").forEach((p) => {
      p.classList.toggle("is-active", Number(p.dataset.panel) === n);
    });
    $$(".step").forEach((s) => {
      const i = Number(s.dataset.step);
      s.classList.toggle("is-active", i === n);
      s.classList.toggle("is-done", i < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- Step 1: validation ---------------- */
  function bindForm() {
    ["name", "email", "whatsapp", "unit"].forEach((k) => {
      const el = $("#" + k);
      el.addEventListener("input", () => {
        state.form[k] = el.value.trim();
        clearError(k);
      });
      el.addEventListener("blur", () => validateField(k));
    });

    $$("[name='bookingType']").forEach((radio) => {
      radio.addEventListener("change", () => {
        state.form.type = radio.value;
        state.form.date = "";
        state.form.time = "";
        clearError("type");
        $$(".type-card").forEach((c) =>
          c.classList.toggle("is-selected", c.querySelector("input") === radio),
        );
        renderCalendar();
      });
    });

    $("#bookingForm").addEventListener("submit", onSubmit);
  }

  function validateStep1() {
    const fields = ["name", "email", "whatsapp", "unit"];
    let ok = true;
    fields.forEach((k) => {
      if (!validateField(k)) ok = false;
    });
    if (!state.form.type) {
      setError("type", "Pilih jenis kunjungan");
      ok = false;
    }
    if (!ok) toast("Lengkapi data diri terlebih dahulu", "error");
    return ok;
  }

  function validateField(key) {
    const el = $("#" + key);
    const val = el.value.trim();
    let err = "";

    if (!val) {
      err = "Wajib diisi";
    } else if (key === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))
        err = "Format email tidak valid";
    } else if (key === "whatsapp") {
      const digits = val.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) err = "Nomor tidak valid";
    } else if (key === "name") {
      if (val.length < 2) err = "Nama terlalu pendek";
    }

    setError(key, err);
    return !err;
  }

  function setError(key, msg) {
    const el = key === "type" ? $("#typeSelect") : $("#" + key);
    const hint = $(`[data-error-for="${key}"]`);
    if (el && el.parentElement)
      el.parentElement.classList.toggle("has-error", !!msg);
    if (hint) hint.textContent = msg || "";
  }

  function clearError(key) {
    setError(key, "");
  }

  /* ---------------- Calendar ---------------- */
  function bindCalendarNav() {
    $("#prevMonth").addEventListener("click", () => moveMonth(-1));
    $("#nextMonth").addEventListener("click", () => moveMonth(1));
  }

  function moveMonth(delta) {
    const c = state.cursor;
    const next = new Date(c.getFullYear(), c.getMonth() + delta, 1);
    const lower = new Date(
      state.today.getFullYear(),
      state.today.getMonth(),
      1,
    );
    const upper = addDays(state.today, CFG.MAX_DAYS_AHEAD || 60);
    if (next < lower) return;
    if (next > upper) return;
    state.cursor = next;
    renderCalendar();
  }

  function renderCalendar() {
    const c = state.cursor;
    const monthName = c.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
    $("#calTitle").textContent = capitalize(monthName);

    const grid = $("#calGrid");
    grid.innerHTML = "";

    // First day of month — start grid on Monday
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const daysInMonth = new Date(
      c.getFullYear(),
      c.getMonth() + 1,
      0,
    ).getDate();

    // Empty leading cells
    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement("div");
      empty.className = "day is-empty";
      grid.appendChild(empty);
    }

    const upper = addDays(state.today, CFG.MAX_DAYS_AHEAD || 60);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(c.getFullYear(), c.getMonth(), d);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day";
      btn.textContent = d;

      const dayOfWeek = date.getDay(); // 0=Sun .. 6=Sat
      const iso = isoDate(date);
      const isPast = date < state.today;
      const isFuture = date > upper;
      const type = state.form.type;
      const isClosed =
        dayOfWeek === 0 ||
        (type === "Serah Terima" && dayOfWeek === 6) ||
        (type === "Re-Schedule" && dayOfWeek >= 1 && dayOfWeek <= 5);

      const slots = getValidSlots(dayOfWeek);
      const status = dayAvailability(iso, dayOfWeek);

      if (sameDay(date, state.today)) btn.classList.add("is-today");

      if (isPast || isClosed || isFuture || slots.length === 0 || status.full) {
        btn.disabled = true;
        if (status.full && !isPast && !isClosed) {
          const b = document.createElement("span");
          b.className = "day__badge full";
          b.textContent = "Penuh";
          btn.appendChild(b);
        }
      } else {
        const b = document.createElement("span");
        b.className = "day__badge" + (status.soon ? " soon" : " avail");
        b.textContent = status.remaining + " slot";
        btn.appendChild(b);
      }

      if (state.form.date === iso) btn.classList.add("is-selected");

      btn.addEventListener("click", () => selectDate(iso, date));
      grid.appendChild(btn);
    }

    // Disable arrows at boundaries
    const lower = new Date(
      state.today.getFullYear(),
      state.today.getMonth(),
      1,
    );
    $("#prevMonth").disabled = c <= lower;
    const nextCursor = new Date(c.getFullYear(), c.getMonth() + 1, 1);
    $("#nextMonth").disabled = nextCursor > upper;
  }

  function dayAvailability(iso, dayOfWeek) {
    const slots = getValidSlots(dayOfWeek);
    if (slots.length === 0) return { full: true, soon: false, remaining: 0 };
    const cap = capacityFor(dayOfWeek);
    if (cap === Infinity && !state.availability)
      return { full: false, soon: false, remaining: Infinity };

    const totalCapacity = slots.length * cap;
    const remaining = slots.reduce(
      (sum, t) => sum + remainingFor(iso, t, dayOfWeek),
      0,
    );
    return {
      full: remaining <= 0,
      soon:
        remaining > 0 &&
        remaining <= Math.max(1, Math.floor(totalCapacity * 0.34)),
      remaining,
    };
  }

  // Sisa kuota satu slot jam: utamakan angka dari backend, fallback hitung lokal
  function remainingFor(iso, time, dayOfWeek) {
    if (state.availability) {
      const v = state.availability[iso] && state.availability[iso][time];
      return typeof v === "number" ? v : 0;
    }
    const cap = capacityFor(dayOfWeek);
    if (cap === Infinity) return Infinity;
    return Math.max(0, cap - countBooked(`${iso} ${time}`));
  }

  function countBooked(rawJadwal) {
    if (!state.bookings.length) return 0;
    let n = 0;
    for (const b of state.bookings) {
      if (b.status === "Hadir" && b.jadwal === rawJadwal) n++;
    }
    return n;
  }

  function selectDate(iso, dateObj) {
    state.form.date = iso;
    state.form.time = "";
    renderCalendar();
    $("#toStep3").disabled = false;
    $("#dateSummary").textContent = humanDate(dateObj);
    renderSlots(dateObj);
  }

  /* ---------------- Time slots ---------------- */
  function renderSlots(dateObj) {
    const wrap = $("#slotsWrap");
    wrap.innerHTML = "";
    const dayOfWeek = dateObj.getDay();
    const slots = getValidSlots(dayOfWeek);
    const iso = isoDate(dateObj);

    if (!slots.length) {
      wrap.innerHTML = `<div class="slots__empty">Tidak ada layanan pada hari ini.</div>`;
      $("#toStep4").disabled = true;
      return;
    }

    const now = new Date();
    const isToday = sameDay(dateObj, state.today);

    slots.forEach((t) => {
      const remaining = remainingFor(iso, t, dayOfWeek);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.dataset.time = t;

      const [h] = t.split(":");
      const endH = String(Number(h) + 1).padStart(2, "0");

      const past = isToday && timeIsPast(now, t);
      const full = remaining <= 0;
      const disabled = past || full;

      btn.innerHTML = `
        <span class="slot__time">${h}.00 – ${endH}.00</span>
        <span class="slot__meta">${past ? "Telah lewat" : full ? "Slot penuh" : "Tersedia"}</span>
      `;
      if (disabled) btn.disabled = true;

      btn.addEventListener("click", () => {
        if (disabled) return;
        state.form.time = t;
        $$(".slot", wrap).forEach((b) =>
          b.classList.toggle("is-selected", b === btn),
        );
      });

      wrap.appendChild(btn);
    });
  }

  function timeIsPast(now, hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    return t.getTime() <= now.getTime();
  }

  /* ---------------- Review ---------------- */
  function renderReview() {
    const f = state.form;
    const dateObj = parseISO(f.date);
    const display = formatDisplay(dateObj, f.time);
    const phone = formatPhone(f.whatsapp);

    $("#review").innerHTML = `
      <dt>Jenis</dt><dd>${escapeHtml(f.type)}</dd>
      <dt>Nama</dt><dd>${escapeHtml(f.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(f.email)}</dd>
      <dt>WhatsApp</dt><dd>${escapeHtml(phone)}</dd>
      <dt>Unit / Blok</dt><dd>${escapeHtml(f.unit)}</dd>
      <dt>Jadwal</dt><dd>${escapeHtml(display)}</dd>
    `;
    $("#agree").checked = false;
    $("#submitBtn").disabled = true;
  }

  /* ---------------- Submit ---------------- */
  async function onSubmit(e) {
    e.preventDefault();
    if (!$("#agree").checked) return;

    const btn = $("#submitBtn");
    btn.classList.add("is-loading");
    btn.disabled = true;

    if (!isApiConfigured()) {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      toast("API URL belum dikonfigurasi pada config.js", "error", 5000);
      return;
    }

    try {
      const f = state.form;

      if (f.type === "Re-Schedule") {
        const checkRes = await fetch(
          `${CFG.API_URL}?email=${encodeURIComponent(f.email)}`,
          { redirect: "follow" },
        );
        const checkJson = await safeJson(checkRes);
        if (!checkJson || !checkJson.hasBooking) {
          toast(
            "Re-Schedule hanya untuk yang sudah memiliki jadwal serah terima sebelumnya.",
            "error",
            5000,
          );
          btn.classList.remove("is-loading");
          btn.disabled = false;
          return;
        }
      }

      const params = new URLSearchParams({
        name: f.name,
        whatsapp: f.whatsapp,
        unit: f.unit,
        date: f.date,
        time: f.time,
        email: f.email,
        type: f.type,
      });

      const res = await fetch(CFG.API_URL, {
        method: "POST",
        body: params,
        redirect: "follow",
      });
      const json = await safeJson(res);

      if (!json || json.success === false) {
        const msg = (json && json.message) || "Gagal mengirim reservasi.";
        toast(msg, "error", 4500);
        if (/penuh/i.test(msg)) fetchBookings();
        btn.classList.remove("is-loading");
        btn.disabled = false;
        return;
      }

      showSuccess(json);
      // refresh list silently
      fetchBookings();
    } catch (err) {
      toast("Tidak dapat terhubung ke server. Coba lagi.", "error");
      btn.classList.remove("is-loading");
      btn.disabled = false;
    }
  }

  function showSuccess(json) {
    const f = state.form;
    const dateObj = parseISO(f.date);
    const display = formatDisplay(dateObj, f.time);
    const isReschedule =
      f.type === "Re-Schedule" ||
      (json.message && json.message.toLowerCase().includes("reschedule"));

    $("#successTitle").textContent = isReschedule
      ? "Jadwal Berhasil Diubah"
      : "Jadwal Anda Sudah Tercatat";
    const [hh] = f.time.split(":");
    const eh = String(Number(hh) + 1).padStart(2, "0");
    $("#successMsg").innerHTML =
      `<span class="success__when"><span>${escapeHtml(humanDate(dateObj))}</span><br>` +
      `<span>Pukul ${hh}.00 – ${eh}.00 WIB</span></span>` +
      (json.emailSent
        ? ""
        : "Saat datang, tunjukkan bukti jadwal di bawah ini kepada petugas.");

    // Cara utama = email. Gambar bukti jadwal = alternatif (terlipat);
    // bila email gagal terkirim, gambar menjadi bukti utama dan langsung terbuka.
    const emailSent = !!json.emailSent;
    $("#successEmail").hidden = !emailSent;
    // Utamakan pindah baris setelah "@" agar nama domain tetap utuh
    $("#successEmailAddr").innerHTML = emailSent
      ? escapeHtml(f.email).replace(/@/g, "@<wbr>")
      : "";
    $("#altHead").hidden = !emailSent;
    const box = $("#ticketBox");
    box.open = !emailSent;
    box.classList.toggle("ticket--primary", !emailSent);

    // Rincian teks: hanya ditampilkan bila tiket gagal dibuat
    $("#successReview").innerHTML = `
      <dt>Jenis</dt><dd>${escapeHtml(f.type)}</dd>
      <dt>Nama</dt><dd>${escapeHtml(f.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(f.email)}</dd>
      <dt>WhatsApp</dt><dd>${escapeHtml(formatPhone(f.whatsapp))}</dd>
      <dt>Unit / Blok</dt><dd>${escapeHtml(f.unit)}</dd>
      <dt>Jadwal</dt><dd>${escapeHtml(display)}</dd>
    `;
    $("#successReview").hidden = true;

    $("#bookingForm").hidden = true;
    $(".stepper").style.display = "none";
    $("#successCard").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    prepareTicket(json);
  }

  /* ---------------- Ticket (bukti jadwal, PNG) ----------------
     Dibuat di browser via Canvas agar konsumen yang tidak terbiasa
     membuka email / menambah kalender tetap punya bukti jadwal.

     Alur simpan dibedakan per perangkat agar tiket berakhir di tempat
     yang dikenal konsumen:
       - iPhone/iPad : unduhan masuk ke app "File" (sulit ditemukan),
                       jadi pakai lembar Bagikan → "Simpan Gambar" → app Foto.
       - Android/PC  : unduh biasa → Galeri / folder Download. */
  const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(navigator.userAgent);

  const ticket = { blob: null, url: "", filename: "", saved: false };

  async function prepareTicket(json) {
    clearTicket();
    const f = { ...state.form };
    try {
      // Tunggu font web agar teks di canvas memakai Inter/Plus Jakarta Sans
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const code =
        json && (json.bookingId || json.kode || json.code || json.id || "");
      const canvas = drawTicket(f, String(code || ""));
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("toBlob gagal");
      ticket.blob = blob;
      ticket.url = URL.createObjectURL(blob);
      ticket.filename = `Bukti-Jadwal-STU-${slug(f.unit)}-${f.date}.png`;

      const img = $("#ticketImg");
      img.src = ticket.url;
      img.alt =
        `Bukti jadwal serah terima unit. Jadwal ${formatDisplay(parseISO(f.date), f.time)} WIB. ` +
        `Nama ${f.name}, unit ${f.unit}.`;
      img.hidden = false;
      $("#ticketLoading").hidden = true;
      $("#ticketFrame").removeAttribute("aria-busy");
      $("#ticketFrame").classList.add("is-ready");

      const share = canShareTicket();
      const iosShare = IS_IOS && share;
      $("#saveTicketLabel").textContent = saveLabel();
      $("#saveTicket").disabled = false;
      // Di iPhone tombol utama sudah memakai lembar Bagikan
      $("#shareTicket").hidden = !share || iosShare;
      if (iosShare)
        $("#ticketHint").innerHTML =
          "Setelah menekan tombol hijau, pilih <b>Simpan Gambar</b>. " +
          "Bisa juga dengan memfoto layar (<i>screenshot</i>).";
    } catch (_) {
      // Gambar gagal dibuat — sembunyikan opsi ini, tampilkan rincian teks
      $("#altProof").hidden = true;
      $("#successReview").hidden = false;
      if (!json || !json.emailSent)
        $("#successMsg").innerHTML +=
          "<br>Mohon foto layar (screenshot) halaman ini sebagai bukti jadwal.";
    }
  }

  function clearTicket() {
    if (ticket.url) URL.revokeObjectURL(ticket.url);
    Object.assign(ticket, { blob: null, url: "", filename: "", saved: false });
    const img = $("#ticketImg");
    img.removeAttribute("src");
    img.alt = "";
    img.hidden = true;
    $("#altProof").hidden = false;
    $("#ticketLoading").hidden = false;
    $("#ticketFrame").setAttribute("aria-busy", "true");
    $("#ticketFrame").classList.remove("is-ready");
    $("#saveTicket").disabled = true;
    $("#saveTicket").classList.remove("is-saved");
    $("#saveTicketLabel").textContent = saveLabel();
    $("#shareTicket").hidden = true;
    $("#ticketStatus").hidden = true;
    $("#ticketHint").innerHTML = DEFAULT_HINT;
  }

  const DEFAULT_HINT =
    "Bisa juga dengan memfoto layar (<i>screenshot</i>), atau tekan lama gambar di atas lalu pilih <b>Simpan</b>.";

  function saveLabel() {
    if (IS_IOS && canShareTicket()) return "Simpan ke Foto";
    if (IS_IOS || IS_ANDROID) return "Simpan ke Galeri HP";
    return "Unduh Gambar";
  }

  async function saveTicket() {
    if (!ticket.url) return;
    if (IS_IOS && canShareTicket()) {
      if (await shareFile())
        markSaved("Jika tadi Anda memilih <b>Simpan Gambar</b>, bukti jadwal ada di aplikasi <b>Foto</b>.");
      return;
    }
    const a = document.createElement("a");
    a.href = ticket.url;
    a.download = ticket.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    markSaved(
      IS_ANDROID
        ? "Berhasil disimpan. Buka aplikasi <b>Galeri</b> (folder <b>Download</b>) untuk melihatnya."
        : "Berhasil diunduh ke folder <b>Unduhan (Downloads)</b>.",
    );
  }

  async function shareTicket() {
    if (await shareFile()) markSaved("Bukti jadwal sudah dikirim.");
  }

  function markSaved(msg) {
    ticket.saved = true;
    $("#saveTicket").classList.add("is-saved");
    $("#saveTicketLabel").textContent = "Sudah Tersimpan";
    const st = $("#ticketStatus");
    st.innerHTML = msg;
    st.hidden = false;
  }

  function ticketFile() {
    return new File([ticket.blob], ticket.filename, { type: "image/png" });
  }

  function canShareTicket() {
    try {
      return (
        !!ticket.blob &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [ticketFile()] })
      );
    } catch (_) {
      return false;
    }
  }

  // true bila lembar Bagikan selesai (bukan dibatalkan pengguna)
  async function shareFile() {
    if (!canShareTicket()) return false;
    try {
      await navigator.share({
        files: [ticketFile()],
        title: "Bukti Jadwal Serah Terima Unit",
        text: "Bukti jadwal serah terima unit — E-STU Cimanggis",
      });
      return true;
    } catch (err) {
      if (err && err.name !== "AbortError")
        toast("Gagal membuka menu. Silakan foto layar (screenshot) sebagai gantinya.", "error", 4500);
      return false;
    }
  }

  function drawTicket(f, code) {
    const W = 1080;
    const P = 72; // padding horizontal
    const SANS = "Inter, system-ui, sans-serif";
    const HEAD = "'Plus Jakarta Sans', Inter, system-ui, sans-serif";
    const C = {
      bg: "#eef2ff",
      card: "#ffffff",
      navy: "#1e3a8a",
      primary: "#1e40af",
      ink: "#0f172a",
      muted: "#5f6b79",
      line: "#d6dae4",
      success: "#047857",
      successSoft: "#ecfdf5",
    };

    // Rincian — dihitung dulu agar tinggi tiket menyesuaikan isi
    const rows = [
      ["Nama", f.name],
      ["Unit / Blok", f.unit],
      ["WhatsApp", formatPhone(f.whatsapp)],
      ["Email", f.email],
    ];
    if (code) rows.unshift(["Kode Booking", code]);
    const labelX = P + 20;
    const valueX = P + 300;
    const valueW = W - P - 20 - valueX;
    const VALUE_FONT = `700 38px ${SANS}`;
    const LINE_H = 50;
    const ROW_GAP = 82;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = VALUE_FONT;
    const rowLines = rows.map(([, v]) =>
      wrapLines(measure, String(v || "-"), valueW, 2),
    );

    const cx = 40, cy = 40, cw = W - 80;
    const DETAILS_Y = cy + 790; // baseline baris rincian pertama
    const lastRowY =
      DETAILS_Y +
      rowLines.reduce((s, l) => s + ROW_GAP + (l.length - 1) * LINE_H, 0) -
      ROW_GAP;
    const NOTE_Y = lastRowY + 64;
    const ISSUED_Y = NOTE_Y + 120 + 54;
    const ch = ISSUED_Y + 40 - cy;
    const H = cy + ch + 40;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "alphabetic";

    // Latar & kartu
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    roundRect(ctx, cx, cy, cw, ch, 36);
    ctx.fillStyle = C.card;
    ctx.fill();

    // Header navy
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, 36);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, cy, 0, cy + 260);
    grad.addColorStop(0, C.primary);
    grad.addColorStop(1, C.navy);
    ctx.fillStyle = grad;
    ctx.fillRect(cx, cy, cw, 260);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText("E-STU CIMANGGIS", P + 20, cy + 92);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 54px ${HEAD}`;
    ctx.fillText("Bukti Jadwal Serah Terima", P + 20, cy + 166);
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = `500 30px ${SANS}`;
    ctx.fillText(f.type ? `Jenis: ${f.type}` : "Bukti Jadwal", P + 20, cy + 216);

    // Status pill
    let y = cy + 260 + 64;
    const pill = "✓  JADWAL TERKONFIRMASI";
    ctx.font = `700 28px ${SANS}`;
    const pw = ctx.measureText(pill).width + 48;
    roundRect(ctx, P + 20, y - 40, pw, 58, 29);
    ctx.fillStyle = C.successSoft;
    ctx.fill();
    ctx.fillStyle = C.success;
    ctx.fillText(pill, P + 44, y - 1);

    // Blok jadwal (paling menonjol)
    const dateObj = parseISO(f.date);
    const hari = capitalize(dateObj.toLocaleDateString("id-ID", { weekday: "long" }));
    const tgl = dateObj.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const [h] = f.time.split(":");
    const eh = String(Number(h) + 1).padStart(2, "0");

    y += 90;
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText("HARI & TANGGAL", P + 20, y);
    y += 70;
    ctx.fillStyle = C.ink;
    ctx.font = `800 60px ${HEAD}`;
    fillFit(ctx, `${hari}, ${tgl}`, P + 20, y, W - 2 * P - 40, 60, HEAD, 800);
    y += 80;
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText("JAM", P + 20, y);
    y += 76;
    ctx.fillStyle = C.primary;
    ctx.font = `800 72px ${HEAD}`;
    ctx.fillText(`${h}.00 – ${eh}.00 WIB`, P + 20, y);

    // Garis sobekan
    y += 70;
    ctx.fillStyle = C.bg;
    ctx.beginPath();
    ctx.arc(cx, y, 28, 0, Math.PI * 2);
    ctx.arc(cx + cw, y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(cx + 48, y);
    ctx.lineTo(cx + cw - 48, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rincian
    y = DETAILS_Y;
    rows.forEach(([k], i) => {
      ctx.fillStyle = C.muted;
      ctx.font = `500 32px ${SANS}`;
      ctx.fillText(k, labelX, y);
      ctx.fillStyle = C.ink;
      ctx.font = VALUE_FONT;
      rowLines[i].forEach((line, j) => ctx.fillText(line, valueX, y + j * LINE_H));
      y += ROW_GAP + (rowLines[i].length - 1) * LINE_H;
    });

    // Catatan bawah
    y = NOTE_Y;
    roundRect(ctx, P + 20, y, W - 2 * P - 40, 120, 20);
    ctx.fillStyle = "#f9fafc";
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText("Tunjukkan bukti ini kepada petugas saat datang.", P + 48, y + 52);
    ctx.fillStyle = C.muted;
    ctx.font = `500 26px ${SANS}`;
    ctx.fillText("Mohon hadir tepat waktu sesuai jadwal yang dipilih.", P + 48, y + 94);

    const issued = new Date().toLocaleString("id-ID", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    ctx.fillStyle = C.muted;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(`Diterbitkan ${issued}`, P + 20, ISSUED_Y);

    return canvas;
  }

  // Tulis teks satu baris; perkecil font bila terlalu panjang, lalu potong dengan "…"
  function fillFit(ctx, text, x, y, maxW, size, family, weight) {
    let s = size;
    const min = Math.round(size * 0.7);
    ctx.font = `${weight} ${s}px ${family}`;
    while (ctx.measureText(text).width > maxW && s > min) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${family}`;
    }
    let t = text;
    if (ctx.measureText(t).width > maxW) {
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      t += "…";
    }
    ctx.fillText(t, x, y);
  }

  // Pecah teks per kata menjadi maks. `max` baris; kata yang terlalu panjang
  // (mis. email) dipotong per karakter; sisa di baris terakhir diberi "…"
  function wrapLines(ctx, text, maxW, max) {
    const fits = (s) => ctx.measureText(s).width <= maxW;
    const lines = [];
    let cur = "";
    const pushWord = (w) => {
      const next = cur ? cur + " " + w : w;
      if (fits(next)) { cur = next; return; }
      if (cur) { lines.push(cur); cur = ""; }
      while (!fits(w)) {
        let i = w.length - 1;
        while (i > 1 && !fits(w.slice(0, i))) i--;
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      cur = w;
    };
    text.split(/\s+/).filter(Boolean).forEach(pushWord);
    if (cur) lines.push(cur);
    if (lines.length <= max) return lines.length ? lines : ["-"];
    const out = lines.slice(0, max);
    let last = out[max - 1] + " " + lines.slice(max).join(" ");
    while (last.length > 1 && !fits(last + "…")) last = last.slice(0, -1);
    out[max - 1] = last.trimEnd() + "…";
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function slug(s) {
    return String(s || "unit").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "unit";
  }

  function resetAll() {
    state.form = {
      name: "",
      email: "",
      whatsapp: "",
      unit: "",
      date: "",
      time: "",
      type: "",
    };
    ["name", "email", "whatsapp", "unit"].forEach((k) => {
      $("#" + k).value = "";
      clearError(k);
    });
    $$("[name='bookingType']").forEach((r) => (r.checked = false));
    $$(".type-card").forEach((c) => c.classList.remove("is-selected"));
    clearError("type");
    clearTicket();
    $("#successCard").hidden = true;
    $("#bookingForm").hidden = false;
    $(".stepper").style.display = "";
    $("#submitBtn").classList.remove("is-loading");
    $("#submitBtn").disabled = true;
    $("#agree").checked = false;
    $("#toStep3").disabled = true;
    $("#dateSummary").textContent = "";
    $("#slotsWrap").innerHTML = "";
    goStep(1);
    renderCalendar();
  }

  /* ---------------- Fetch bookings ---------------- */
  async function fetchBookings() {
    if (!isApiConfigured()) return;
    if (state.bookingsLoading) return;
    state.bookingsLoading = true;
    try {
      const res = await fetch(`${CFG.API_URL}?action=availability`, {
        method: "GET",
        redirect: "follow",
      });
      const json = await safeJson(res);
      if (json && json.success && json.slots && typeof json.slots === "object") {
        state.availability = json.slots;
        state.bookingsLoaded = true;
        renderCalendar();
        if (state.form.date) renderSlots(parseISO(state.form.date));
      } else if (Array.isArray(json)) {
        // Backend lama (belum ada ?action=availability) → hitung dari daftar jadwal
        // Normalize jadwal: Google Sheets may serialize Date objects as ISO UTC strings.
        // Convert to "YYYY-MM-DD HH:mm" in WIB (UTC+7) to match slot comparison keys.
        state.bookings = json
          .filter(
            (b) =>
              b &&
              typeof b === "object" &&
              b.jadwal &&
              String(b.jadwal).trim() &&
              b.status &&
              String(b.status).trim(),
          )
          .map((b) => ({
            jadwal: normalizeJadwal(b.jadwal),
            status: String(b.status).trim(),
          }))
          .filter((b) => b.jadwal !== null);
        state.bookingsLoaded = true;
        renderCalendar();
        if (state.form.date) renderSlots(parseISO(state.form.date));
      }
    } catch (_) {
      /* offline ok */
    } finally {
      state.bookingsLoading = false;
    }
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
    const yr = wib.getUTCFullYear();
    const mo = String(wib.getUTCMonth() + 1).padStart(2, "0");
    const dy = String(wib.getUTCDate()).padStart(2, "0");
    const hr = String(wib.getUTCHours()).padStart(2, "0");
    const mn = String(wib.getUTCMinutes()).padStart(2, "0");
    return `${yr}-${mo}-${dy} ${hr}:${mn}`;
  }

  function isApiConfigured() {
    return CFG.API_URL && !/REPLACE_WITH_YOUR_DEPLOYMENT_ID/.test(CFG.API_URL);
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, type = "", duration = 3200) {
    const el = $("#toast");
    el.className = "toast" + (type ? " is-" + type : "");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-visible");
      setTimeout(() => {
        el.hidden = true;
      }, 250);
    }, duration);
  }

  /* ---------------- Helpers ---------------- */
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  function isoDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function parseISO(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function humanDate(d) {
    const hari = d.toLocaleDateString("id-ID", { weekday: "long" });
    const tgl = d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return `${capitalize(hari)}, ${tgl}`;
  }
  function formatDisplay(d, time) {
    const hari = capitalize(d.toLocaleDateString("id-ID", { weekday: "long" }));
    const tgl = d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const [h] = time.split(":");
    const eh = String(Number(h) + 1).padStart(2, "0");
    return `${hari}, ${tgl} — ${h}.00–${eh}.00`;
  }
  function formatPhone(n) {
    const digits = String(n).replace(/\D/g, "");
    if (!digits) return n;
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  function capitalize(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  async function safeJson(res) {
    try {
      return await res.json();
    } catch {
      try {
        const t = await res.text();
        return JSON.parse(t);
      } catch {
        return null;
      }
    }
  }
})();
