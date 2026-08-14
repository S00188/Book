// src/repositories/paymentsRepository.js
// To'lovlar bo'yicha barcha DB access logikasi.

const { load, persist } = require("../db");
const crypto = require("crypto");

// Premium paketlar narxlari (so'mda)
const PLAN_PRICES = {
  "1month": 50000,
  "3months": 120000,
  "1year": 400000,
};

const PLAN_DURATIONS = {
  "1month": 30 * 24 * 60 * 60 * 1000,      // 30 kun (ms)
  "3months": 90 * 24 * 60 * 60 * 1000,     // 90 kun (ms)
  "1year": 365 * 24 * 60 * 60 * 1000,      // 365 kun (ms)
};

// Yangi to'lov yaratish
// return payment
async function createPayment(userId, plan, checkImageData) {
  const db = load();
  const id = "pay_" + crypto.randomBytes(8).toString("hex");
  const now = new Date().toISOString();

  const payment = {
    id,
    userId: String(userId),
    plan,
    amount: PLAN_PRICES[plan] || PLAN_PRICES["1month"],
    status: "pending",
    checkImageData,
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null,
  };

  db.payments[id] = payment;
  await persist();
  return payment;
}

// To'lovni olish
function getPayment(id) {
  const db = load();
  return db.payments[id] || null;
}

// Foydalanuvchining to'lovlari ro'yxati
function getUserPayments(userId) {
  const db = load();
  return Object.values(db.payments)
    .filter(p => p.userId === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Barcha to'lovlar ro'yxati (admin uchun)
function listPayments(filter = {}) {
  const db = load();
  let payments = Object.values(db.payments);

  if (filter.status) {
    payments = payments.filter(p => p.status === filter.status);
  }

  return payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// To'lovni tasdiqlash
async function approvePayment(paymentId, adminId) {
  const db = load();
  const payment = db.payments[paymentId];
  if (!payment) return null;
  if (payment.status !== "pending") return null;

  // Foydalanuvchi hali DB'da yo'q bo'lsa (masalan hech qachon /api/profile
  // chaqirilmagan holat) — jim muvaffaqiyat qaytarish o'rniga aniq xato
  // beramiz, aks holda to'lov "approved" bo'lib qoladi-yu, Premium hech
  // qachon berilmaydi (aniqlash qiyin bo'lgan jim xato).
  const user = db.users[payment.userId];
  if (!user) {
    return { error: "USER_NOT_FOUND" };
  }

  payment.status = "approved";
  payment.reviewedAt = new Date().toISOString();
  payment.reviewedBy = String(adminId);

  // Foydalanuvchiga premium berish
  {
    const now = Date.now();
    const duration = PLAN_DURATIONS[payment.plan] || PLAN_DURATIONS["1month"];
    const expiresAt = new Date(now + duration).toISOString();

    user.premium = {
      status: "active",
      plan: payment.plan,
      expiresAt,
      activatedAt: new Date().toISOString(),
    };
    user.updatedAt = new Date().toISOString();
  }

  await persist();
  return payment;
}

// To'lovni rad etish
async function rejectPayment(paymentId, adminId) {
  const db = load();
  const payment = db.payments[paymentId];
  if (!payment) return null;
  if (payment.status !== "pending") return null;

  payment.status = "rejected";
  payment.reviewedAt = new Date().toISOString();
  payment.reviewedBy = String(adminId);

  await persist();
  return payment;
}

// Kutilayotgan to'lovlar soni
function countPendingPayments() {
  const db = load();
  return Object.values(db.payments).filter(p => p.status === "pending").length;
}

// To'lov statistikasi
function getPaymentStats() {
  const db = load();
  const payments = Object.values(db.payments);
  return {
    total: payments.length,
    pending: payments.filter(p => p.status === "pending").length,
    approved: payments.filter(p => p.status === "approved").length,
    rejected: payments.filter(p => p.status === "rejected").length,
    totalAmount: payments.filter(p => p.status === "approved").reduce((sum, p) => sum + p.amount, 0),
  };
}

module.exports = {
  PLAN_PRICES,
  PLAN_DURATIONS,
  createPayment,
  getPayment,
  getUserPayments,
  listPayments,
  approvePayment,
  rejectPayment,
  countPendingPayments,
  getPaymentStats,
};
