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
    "https://script.google.com/macros/s/AKfycbwq-oHqhCtvklqLmu20Plkp5JTNEKSI7Z1-va91BVB8ihSgsxYb37nusmyEQxIqTcd7/exec",

  // Maksimal hari ke depan yang bisa dipilih
  MAX_DAYS_AHEAD: 60,

  // Kapasitas slot per hari (mengikuti Apps Script: Sabtu=1, lainnya tidak dibatasi)
  // Atur null untuk "tidak dibatasi" agar UX selaras dengan backend.
  CAPACITY_BY_DAY: {
    1: null, // Senin
    2: null, // Selasa
    3: null, // Rabu
    4: null, // Kamis
    5: null, // Jumat
    6: 1, // Sabtu (sesuai validasi backend)
  },
};
