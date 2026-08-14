// bot.js
// KinoBot uchun Telegram bot:
//   /start   — tabriklash + WebApp tugmasi (🎬 Kino katalogi + ❓ Yordam)
//   /catalog — kino katalogini ochadigan WebApp tugmasi
//   /help    — barcha buyruqlar ro'yxati
//   /admin   — admin panel (faqat ADMIN_ID bo'lsa; aks holda muloyim rad etish)
//
// Faqat Node.js ichki modullaridan foydalanadi (https) — tashqi kutubxona yo'q.
// Long polling (getUpdates) — webhook/HTTPS server shart emas.
// Tarmoq xatolari va 409 Conflict uchun exponential backoff.
// SIGINT/SIGTERM bilan toza (graceful) to'xtash.
//
// Ishga tushirish:  node bot.js
// Talab qilinadi (.env faylda): BOT_TOKEN, WEBAPP_URL, ADMIN_ID (ixtiyoriy)

const https = require("https");
const fs = require("fs");
const path = require("path");

// --- .env yuklovchi (server.js dagi bilan bir xil) -------------------------
(function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : "";
const CHANNEL_ID = process.env.CHANNEL_ID ? String(process.env.CHANNEL_ID) : ""; // Kanal ID (@kanalusername yoki -100xxxxxx)

if (!BOT_TOKEN) {
  console.error("XATO: .env faylda BOT_TOKEN topilmadi.");
  process.exit(1);
}
if (!WEBAPP_URL || !WEBAPP_URL.startsWith("https://")) {
  console.error(
    "XATO: .env faylda WEBAPP_URL https:// bilan boshlanishi kerak " +
      "(Telegram WebApp faqat HTTPS manzillarni qabul qiladi)."
  );
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// --- Kanal import moduli -----------------------------------------------------
const { importFromChannelMessage, getMovieByCode } = require("./src/channelImport");

// --- Graceful shutdown holati ----------------------------------------------
// SIGINT/SIGTERM kelganda pollLoop to'xtaydi va jarayon toza chiqadi.
let shuttingDown = false;
let activeReq = null; // hozirgi https so'rov — shutdown'da bekor qilinadi

// --- Kichik yordamchi: Telegram Bot API'ga so'rov yuborish -----------------
function apiRequest(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = https.request(
      `${API_BASE}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (activeReq === req) activeReq = null;
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    activeReq = req;
    req.on("error", (e) => {
      if (activeReq === req) activeReq = null;
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff: 1->1x, 2->2x, 3->4x ... (maksimum 30s + jitter).
// Jitter — bir vaqtda ko'p bot bir xil daqiqada urinmasligi uchun.
function backoffDelay(attempt, baseMs) {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), 30000);
  return exp + Math.floor(Math.random() * 500);
}

// --- Inline klaviaturalar ----------------------------------------------------
function catalogKeyboard(extraRows) {
  return {
    inline_keyboard: [
      [{ text: "🎬 Kino katalogi", web_app: { url: WEBAPP_URL } }],
      ...(extraRows || []),
    ],
  };
}

// --- Xabarlar ----------------------------------------------------------------
async function sendWelcome(chatId, firstName) {
  const name = firstName ? `, ${firstName}` : "";
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text:
      `Salom${name}! 👋\n\n` +
      `KinoBot'ga xush kelibsiz. 12 ekranli kino ilovasi: katalog, ` +
      `qidiruv, sevimlilar, ko'rish tarixi va player.\n\n` +
      `Kino katalogini ochish uchun tugmani bosing 👇`,
    reply_markup: catalogKeyboard([[{ text: "❓ Yordam", callback_data: "help" }]]),
  });
}

async function sendCatalog(chatId) {
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text: "🎬 Kino katalogi sizni kutmoqda!",
    reply_markup: catalogKeyboard(),
  });
}

async function sendHelp(chatId) {
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text:
      `📖 Yordam — KinoBot\n\n` +
      `Mavjud buyruqlar:\n` +
      `/start — botni ishga tushirish\n` +
      `/catalog — kino katalogini ochish\n` +
      `/help — bu yordam xabari\n` +
      `/admin — admin panel (faqat adminlar)\n\n` +
      `Yoki pastdagi tugma orqali katalogga kiring 👇`,
    reply_markup: catalogKeyboard(),
  });
}

async function sendAdminPanel(chatId) {
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text:
      "🛠 Admin panel WebApp ichida (#admin) ochiladi. Backend admin " +
      "so'rovlari uchun X-Admin-Key header ishlatiladi.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛠 Admin panelni ochish", web_app: { url: `${WEBAPP_URL}#admin` } }],
      ],
    },
  });
}

// Muloyim rad etish — /admin noto'g'ri user'ga.
async function sendAdminDenied(chatId) {
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text:
      "Uzr, bu buyruq faqat adminlar uchun mavjud. 😊\n" +
      "Kino katalogini ochish uchun /start yoki /catalog ni yozing.",
    reply_markup: catalogKeyboard(),
  });
}

// --- Buyruqlarni Telegram'ga ro'yxatdan o'tkazish ----------------------------
async function setMyCommands() {
  const commands = [
    { command: "start", description: "Botni ishga tushirish" },
    { command: "catalog", description: "Kino katalogini ochish" },
    { command: "help", description: "Yordam" },
    { command: "admin", description: "Admin panel (faqat adminlar)" },
  ];
  const res = await apiRequest("setMyCommands", { commands });
  if (!res.ok) {
    console.warn("setMyCommands xatosi:", res.description || res);
    return;
  }
  console.log(
    `setMyCommands: ${commands.length} ta buyruq Telegram'ga o'rnatildi ` +
      `(${commands.map((c) => "/" + c.command).join(", ")})`
  );
}

// --- Long polling asosiy sikli ----------------------------------------------
let offset = 0;

async function pollLoop() {
  let errorCount = 0;

  while (!shuttingDown) {
    try {
      const res = await apiRequest("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query", "channel_post"],
      });

      if (shuttingDown) break;

      if (!res.ok) {
        // 409 — yana bir bot nusxasi bir xil token bilan poll qilmoqda.
        // Bu tugatilmaydigan xato, shuning uchun tez-tez urinmaymiz.
        if (res.error_code === 409) {
          console.error(
            "409 Conflict: yana bir bot nusxasi ishlayapti! " +
              "Long polling faqat bitta jarayon qila oladi."
          );
        } else {
          console.error("getUpdates xatosi:", res.description || res);
        }
        errorCount++;
        await sleep(backoffDelay(errorCount, 3000));
        continue;
      }

      errorCount = 0; // muvaffaqiyat — hisobni nollaymiz

      for (const update of res.result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((e) => console.error("Update xatosi:", e));
      }
    } catch (e) {
      if (shuttingDown) break;
      console.error("Polling xatosi:", e.message);
      errorCount++;
      await sleep(backoffDelay(errorCount, 3000));
    }
  }

  console.log("Polling to'xtadi. Xayr! 👋");
  process.exit(0);
}

// --- Update'larni yo'naltirish -----------------------------------------------
async function handleUpdate(update) {
  // Inline tugma (callback) — masalan "❓ Yordam" bosilganda
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message && cq.message.chat ? cq.message.chat.id : null;
    if (cq.data === "help") {
      // Tugmadagi "yuklanmoqda" belgisini o'chirish
      await apiRequest("answerCallbackQuery", { callback_query_id: cq.id });
      if (chatId) await sendHelp(chatId);
    }
    return;
  }

  // Channel post (kanalda yuborilgan xabar) - admin video yuklaganda
  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const fromId = msg.from ? String(msg.from.id) : "";
  const firstName = msg.from ? msg.from.first_name : "";

  // Foydalanuvchi kod yuborganda (video/caption yo'q, faqat matn)
  if (msg.text) {
    const text = msg.text.trim();

    if (text === "/start") {
      await sendWelcome(chatId, firstName);
      return;
    }

    if (text === "/catalog" || text === "/webapp") {
      await sendCatalog(chatId);
      return;
    }

    if (text === "/help") {
      await sendHelp(chatId);
      return;
    }

    if (text === "/admin") {
      if (ADMIN_ID) {
        if (fromId === ADMIN_ID) {
          await sendAdminPanel(chatId);
        } else {
          await sendAdminDenied(chatId);
        }
      } else {
        await apiRequest("sendMessage", {
          chat_id: chatId,
          text:
            "Admin sozlanmagan: server egasi ADMIN_ID ni .env faylda " +
            "o'rnatishi kerak.",
        });
      }
      return;
    }

    // Kod formatini tekshirish (faqat alfanumerik, tire, pastki chiziq, 3-20 belgi)
    const codePattern = /^[A-Z0-9_-]{3,20}$/i;
    if (codePattern.test(text)) {
      await handleCodeMessage(chatId, text, fromId);
      return;
    }

    // Noma'lum buyruq — yordamga yo'naltiramiz
    if (text.startsWith("/")) {
      await apiRequest("sendMessage", {
        chat_id: chatId,
        text: "🤔 Bu buyruqni tanimayman. /help — barcha buyruqlar ro'yxati.",
      });
    }
  }
}

// Kanal postini qayta ishlash (admin video + caption yuborganida)
async function handleChannelPost(msg) {
  // Agar CHANNEL_ID sozlanmagan bo'lsa, barcha kanallarni qabul qilamiz
  // Agar sozlangan bo'lsa, faqat shu kanalni tekshiramiz
  if (CHANNEL_ID) {
    const msgChatId = String(msg.chat.id);
    const configChatId = CHANNEL_ID.startsWith("@") ? CHANNEL_ID : String(CHANNEL_ID);
    if (msgChatId !== configChatId && msgChatId !== configChatId.replace("@", "")) {
      console.log(`Kanal ID mos kelmadi: kutilgan=${configChatId}, kelgan=${msgChatId}`);
      return;
    }
  }

  // Video yoki document/video bo'lishi kerak
  const hasVideo = msg.video || (msg.document && msg.document.mime_type?.startsWith("video/"));
  if (!hasVideo) {
    console.log("Kanal postida video yo'q, o'tkazib yuborilmoqda");
    return;
  }

  // Caption bo'lishi kerak (format: KOD:, NOM:, YIL:, JANR:)
  if (!msg.caption && !msg.text) {
    console.log("Kanal postida caption yo'q, o'tkazib yuborilmoqda");
    return;
  }

  try {
    console.log("Kanal postidan film import qilinmoqda...");
    const result = await importFromChannelMessage({
      botToken: BOT_TOKEN,
      message: msg,
      adminId: ADMIN_ID,
    });

    console.log(`✅ Film import qilindi: ${result.movie.title} (Kod: ${result.code})`);

    // Admin ga xabar berish (agar ADMIN_ID bo'lsa)
    if (ADMIN_ID) {
      await apiRequest("sendMessage", {
        chat_id: ADMIN_ID,
        text:
          `✅ <b>Kanal import muvaffaqiyatli!</b>\n\n` +
          `🎬 <b>Film:</b> ${result.movie.title}\n` +
          `🔑 <b>Kod:</b> <code>${result.code}</code>\n` +
          `📊 <b>Sifat:</b> ${result.videoQuality}\n` +
          `☁️ <b>Saqlash:</b> ${result.storageType.toUpperCase()}\n\n` +
          `Foydalanuvchilar endi botga <code>${result.code}</code> kodini yuborib kinoni ko'rishi mumkin.`,
        parse_mode: "HTML",
      });
    }
  } catch (e) {
    console.error("Kanal import xatosi:", e.message);

    // Admin ga xato haqida xabar berish
    if (ADMIN_ID) {
      await apiRequest("sendMessage", {
        chat_id: ADMIN_ID,
        text:
          `❌ <b>Kanal import xatosi:</b>\n\n` +
          `<code>${e.message}</code>\n\n` +
          `Iltimos, formatni tekshiring:\n` +
          `<b>KOD:</b> ABC123\n` +
          `<b>NOM:</b> Film nomi\n` +
          `<b>YIL:</b> 2024\n` +
          `<b>JANR:</b> Action, Drama\n\n` +
          `Va video faylni birga yuboring.`,
        parse_mode: "HTML",
      });
    }
  }
}

// Foydalanuvchi kod yuborganida
async function handleCodeMessage(chatId, code, fromId) {
  const movie = getMovieByCode(code);
  if (!movie) {
    await apiRequest("sendMessage", {
      chat_id: chatId,
      text:
        `❌ <b>"${code}" kodi bilan film topilmadi.</b>\n\n` +
        `Iltimos, kodni tekshirib qayta yuboring.\n` +
        `Katalogdan film tanlash uchun /catalog buyrug'ini ishlating.`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎬 Kino katalogi", web_app: { url: WEBAPP_URL } }],
        ],
      },
    });
    return;
  }

  // Film topildi - WebApp ochish tugmasi bilan yuborish
  await apiRequest("sendMessage", {
    chat_id: chatId,
    text:
      `✅ <b>Film topildi!</b>\n\n` +
      `🎬 <b>${movie.title}</b> ${movie.year ? `(${movie.year})` : ""}\n` +
      `${movie.genres?.length ? `🎭 ${movie.genres.join(", ")}` : ""}\n` +
      `${movie.rating ? `⭐ ${movie.rating}/10` : ""}\n\n` +
      `Kinoni tomosha qilish uchun pastdagi tugmani bosing 👇`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Tomosha qilish", web_app: { url: `${WEBAPP_URL}#movie/${movie.id}` } }],
        [{ text: "🎬 Kino katalogi", web_app: { url: WEBAPP_URL } }],
      ],
    },
  });
}

// --- Graceful shutdown --------------------------------------------------------
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] To'xtatilmoqda...`);

  // Kutib turgan long-poll so'rovini bekor qilamiz (30s kutishni qisqartiradi)
  if (activeReq) {
    try {
      activeReq.destroy();
    } catch (e) {
      /* e'tiborsiz */
    }
  }

  // Agar 5 soniyada toza chiqmasa — majburiy chiqish (jarayonni ushlab turmaydi)
  setTimeout(() => {
    console.error("To'xtash 5 soniyada yakunlanmadi — majburiy chiqish.");
    process.exit(1);
  }, 5000).unref();
}

process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));

// --- Ishga tushirish ---------------------------------------------------------
(async () => {
  // getMe — tarmoq vaqtincha uzilib qolsa ham (ETIMEDOUT va h.k.) bot tushmaydi:
  // backoff bilan 5 urinish qilinadi. Faqat tarmoq xatosi qayta uriniladi —
  // noto'g'ri token (Telegram javob berdi) darhol chiqib ketadi.
  let me = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      me = await apiRequest("getMe", {});
      if (me.ok) break;
      // Telegram javob berdi, lekin token noto'g'ri — qayta urinish befoyda
      console.error("Bot tokeni noto'g'ri yoki bot topilmadi:", me);
      process.exit(1);
    } catch (e) {
      console.error(`getMe tarmoq xatosi (urinish ${attempt}/5): ${e.message}`);
      if (attempt < 5) await sleep(backoffDelay(attempt, 2000));
    }
  }
  if (!me || !me.ok) {
    console.error("Telegram'ga 5 urinishda ulanib bo'lmadi. Jarayon to'xtadi.");
    process.exit(1);
  }
  console.log(`Bot ishga tushdi: @${me.result.username}`);
  console.log(`WebApp URL: ${WEBAPP_URL}`);
  if (ADMIN_ID) console.log(`Admin ID: ${ADMIN_ID}`);

  // Buyruqlar ro'yxatini Telegram'ga yozamiz (xato bo'lsa ham bot ishlaydi)
  try {
    await setMyCommands();
  } catch (e) {
    console.warn("setMyCommands bajarilmadi:", e.message);
  }

  pollLoop();
})();
