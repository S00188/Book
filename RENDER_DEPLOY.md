# KinoBot'ni Render'ga joylash — bosqichma-bosqich

Bu qo'llanma **loyiha kodini bitta qatorini ham o'zgartirmasdan** KinoBot'ni
Render.com'da ishga tushiradi. Sabab: `backend/server.js` allaqachon
`frontend/` papkasini o'zi xizmat qiladi (kodda "Static file serving"
qismiga qarang) — shuning uchun API ham, WebApp ham bitta xizmatda, bitta
manzilda ishlaydi. Telegram bot esa alohida, uzluksiz ishlaydigan jarayon
sifatida ("Background Worker") ishga tushadi.

Tayyorlab qo'yilgan `render.yaml` fayli aynan shu ikkita xizmatni avtomatik
yaratadi.

---

## 0. Nima kerak bo'ladi

- GitHub (yoki GitLab) akkaunt — Render kodni **git repodan** oladi, zip
  fayldan emas.
- Render.com akkaunt (GitHub bilan kirish mumkin).
- BotFather'dan olingan `BOT_TOKEN` (allaqachon bor bo'lsa — o'zingizdagi
  `.env`dan oling, lekin uni hech qayerga commit qilmang).

## 1. Kodni GitHub'ga yuklash

```bash
cd kinobot-project
git init
git add .
```

**MUHIM:** commit qilishdan oldin `.env`, `backend/.env` fayllarini
tekshiring — ular repo `.gitignore`sida bo'lishi kerak (BOT_TOKEN,
ADMIN_KEY kabi maxfiy qiymatlar bor). Zip ichida ular allaqachon mavjud —
agar `.gitignore`da yo'q bo'lsa, qo'shing:

```bash
echo -e "backend/.env\n.env\nbackend/data/\nbackend/logs/\nvideos/" >> .gitignore
git rm --cached backend/.env .env 2>/dev/null
git add .gitignore
git commit -m "KinoBot — Render uchun tayyor"
git branch -M main
git remote add origin https://github.com/SIZNING_USERNAME/kinobot.git
git push -u origin main
```

## 2. render.yaml'ni loyiha ildiziga qo'shish

Ushbu javob bilan birga berilgan `render.yaml` faylini loyihaning **eng
tashqi papkasiga** (README.md, docker-compose.yml bilan bir qatorga)
joylashtiring va commit/push qiling:

```bash
cp render.yaml /path/to/kinobot-project/render.yaml
cd /path/to/kinobot-project
git add render.yaml
git commit -m "Render blueprint qo'shildi"
git push
```

## 3. Render'da Blueprint orqali deploy qilish

1. https://dashboard.render.com → **New** → **Blueprint**.
2. GitHub repongizni tanlang (kinobot).
3. Render `render.yaml`ni avtomatik topadi va 2 ta xizmatni ko'rsatadi:
   - `kinobot-api` (Web Service)
   - `kinobot-bot` (Background Worker)
4. **Apply** tugmasini bosing — ikkalasi ham yaratiladi, lekin maxfiy
   o'zgaruvchilar (`sync: false` bo'lganlar) hali bo'sh, ular kelmaguncha
   xizmatlar to'liq ishlamaydi.

## 4. Muhit o'zgaruvchilarini to'ldirish

Render dashboard → **kinobot-api** → **Environment**:

| Kalit | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather bergan token |
| `ADMIN_ID` | Sizning Telegram ID'ingiz |
| `ADMIN_KEY` | O'zingiz o'ylab topgan kuchli parol (X-Admin-Key uchun) |
| `WEBAPP_URL` | Shu xizmatning o'zi — deploydan keyin Render beradigan URL, masalan `https://kinobot-api.onrender.com` |
| `ALLOWED_ORIGINS` | Odatda bo'sh qoldiring (frontend bir xil origin) |
| R2 kalitlari (ixtiyoriy) | Video'ni Cloudflare R2'da saqlamoqchi bo'lsangiz to'ldiring — bo'lmasa, video doimiy diskka (`LOCAL_VIDEOS_DIR`) yoziladi, bu allaqachon sozlangan |

Xuddi shu `BOT_TOKEN`, `ADMIN_ID`, `WEBAPP_URL` qiymatlarini
**kinobot-bot** xizmatiga ham kiriting (ikkalasida bir xil bo'lishi kerak).

`WEBAPP_URL`ni birinchi marta faqat API deploy bo'lib, URL manzili
ma'lum bo'lgandan keyin to'ldirasiz — so'ng **Manual Deploy → Deploy
latest commit** bilan qayta ishga tushiring (yoki shunchaki "Save" —
Render env o'zgarganda avtomatik qayta ishga tushiradi).

## 5. Tekshirish

- `https://kinobot-api.onrender.com/api/health` — `{"ok":true,...}`
  qaytarishi kerak.
- `https://kinobot-api.onrender.com/` — WebApp (frontend) ochilishi kerak.
- Telegram botga `/start` yuboring — WebApp tugmasi shu manzilni ochadi.
- `kinobot-bot` xizmatining **Logs** bo'limida "polling boshlandi" kabi
  xabarni ko'rasiz — bot ishga tushgani shu.

## 6. Ma'lumotlar (db.json, poster, video) haqida — MUHIM

`render.yaml`dagi **Disk** (`kinobot-data`, `backend/data`ga ulangan)
quyidagilarni doimiy saqlaydi:
- `db.json` (filmlar, foydalanuvchilar, sevimlilar, tarix, to'lovlar)
- yuklangan posterlar (`backend/data/posters`)
- banner rasmi (`backend/data/banner`)
- R2 ishlatilmasa — video fayllar ham (`LOCAL_VIDEOS_DIR` shu diskka
  yo'naltirilgan)

**Disk faqat Starter va undan yuqori tarifda ishlaydi** (Free tarifda
disk yo'q — bu holda konteyner har safar qayta ishga tushganda /
deploy qilinganda **barcha ma'lumot yo'qoladi**). Shuning uchun
`render.yaml`da `plan: starter` qo'yilgan — bu haqiqiy foydalanuvchi
ma'lumotlarini yo'qotmaslik uchun zarur, "tizimni buzmaslik" talabining
bir qismi.

Agar baribir Free tarifda sinab ko'rmoqchi bo'lsangiz: ishlaydi, lekin
har deploy/uyqu-uyg'onishda ma'lumot boshidan boshlanadi — faqat demo/test
uchun mos.

## 7. Nima o'zgartirilmadi

- `backend/`, `frontend/` ichidagi birorta ham kod fayli tegilmagan.
- `docker-compose.yml`, `Dockerfile`, `deploy/` (systemd/nginx variant)
  — barchasi o'z holicha qoladi, xohlasangiz o'z serveringizda ham
  parallel ishlata olasiz.
- Yagona qo'shilgan narsa — shu ikkita fayl: `render.yaml` va ushbu
  qo'llanma.
