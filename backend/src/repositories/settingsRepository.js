// src/repositories/settingsRepository.js
// Ilova sozlamalari (DB'ning `settings` kolleksiyasi):
//   - adminPasswordHash — admin panel paroli (scrypt hash)
//   - banner — bosh sahifa banneri (reklama yoki tanlangan film)
//
// Repository'lar server.js → repositories → db (JSON file) zanjirida ishlaydi.

const db = require("../db");

function getSetting(key) {
  const d = db.load();
  const s = d.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) return undefined;
  return s[key];
}

function setSetting(key, value) {
  const d = db.load();
  if (!d.settings || typeof d.settings !== "object" || Array.isArray(d.settings)) d.settings = {};
  d.settings[key] = value;
  return db.persist();
}

// ---- Admin panel paroli ----
// O'rnatilmagan bo'lsa bo'sh string qaytadi — u holda .env'dagi ADMIN_KEY ishlatiladi.
function getAdminPasswordHash() {
  const v = getSetting("adminPasswordHash");
  return typeof v === "string" ? v : "";
}

function setAdminPasswordHash(hash) {
  return setSetting("adminPasswordHash", hash);
}

// ---- Bosh sahifa banneri (reklama / film) ----
function getBanner() {
  const v = getSetting("banner");
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function setBanner(banner) {
  return setSetting("banner", banner);
}

module.exports = {
  getSetting,
  setSetting,
  getAdminPasswordHash,
  setAdminPasswordHash,
  getBanner,
  setBanner,
};
