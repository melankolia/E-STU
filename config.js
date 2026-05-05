/* =========================================================
   Cimanggis Reservation — Configuration
   ---------------------------------------------------------
   Ganti API_URL dengan URL Web App Google Apps Script Anda
   (yang berakhiran "/exec"). Pastikan deployment-nya:
     - Execute as : Me
     - Who has access : Anyone
   ========================================================= */
window.APP_CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbw1k2JY9mKmqmRel2YM3iGj-8Nz6sOfZTr44MdNTu93iWrG-qwzP9uepm5duUUnMkIN/exec",

  // Maksimal hari ke depan yang bisa dipilih
  MAX_DAYS_AHEAD: 60,

  // Kapasitas slot per hari (mengikuti Apps Script: Sabtu=1, lainnya tidak dibatasi)
  // Atur null untuk "tidak dibatasi" agar UX selaras dengan backend.
  CAPACITY_BY_DAY: {
    1: 1, // Senin
    2: 1, // Selasa
    3: 1, // Rabu
    4: 1, // Kamis
    5: 1, // Jumat
    6: 1, // Sabtu (sesuai validasi backend)
  },
};
