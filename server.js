require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 🗄 MA'LUMOTLAR BAZASI (PostgreSQL) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Admin ID sini o'zgaruvchiga olamiz (Bu sening Telegram ID raqaming bo'lishi shart)
const ADMIN_ID = 5440366627; // O'zingizning ID raqamingizni yozing

// --- ⚙️ BAZANI TAYYORLASH ---
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      balance INT DEFAULT 0,
      tickets INT DEFAULT 0,
      last_card_index INT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      card_number TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      amount INT,
      photo_id TEXT,
      status TEXT DEFAULT 'pending'
    );
  `);
}
initDB();

// --- 💳 KARTA ROTATSIYASI LOGIKASI ---
async function getNextCard(user_id) {
  const cards = await pool.query('SELECT * FROM cards WHERE is_active = TRUE ORDER BY id ASC');
  if (cards.rows.length === 0) return null;

  const user = await pool.query('SELECT last_card_index FROM users WHERE telegram_id = $1', [user_id]);
  let nextIndex = (user.rows[0].last_card_index + 1) % cards.rows.length;

  await pool.query('UPDATE users SET last_card_index = $1 WHERE telegram_id = $2', [nextIndex, user_id]);
  return cards.rows[nextIndex];
}

// --- 🤖 BOT KOMANDALARI ---

// Start: Foydalanuvchini ro'yxatga olish
bot.start(async (ctx) => {
  const { id, username } = ctx.from;
  await pool.query(
    'INSERT INTO users (telegram_id, username) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING',
    [id, username]
  );
  ctx.reply(`👑 RICH OMAD loyihasiga xush kelibsiz!\nPastdagi tugma orqali o'yinni boshlang.`, 
    Markup.keyboard([['💰 Balansni to'ldirish'], ['🎰 O'yinni boshlash']]).resize()
  );
});

// To'lovni boshlash: Karta rotatsiyasi va ko'rsatish
bot.hears('💰 Balansni to'ldirish', async (ctx) => {
  const card = await getNextCard(ctx.from.id);
  if (!card) return ctx.reply("Hozircha faol kartalar yo'q. Iltimos, adminga murojaat qiling.");

  ctx.reply(
    `💳 To'lov qilish uchun karta:\n\n` +
    `🔢 Rakan: \`${card.card_number}\`\n` +
    `👤 Ega: **${card.owner_name}**\n\n` +
    `⚠️ To'lovni amalga oshirgach, summani yozing va skrinshotni yuboring!`,
    { parse_mode: 'Markdown' }
  );
});

// Skrinshot va summani qabul qilish
bot.on('photo', async (ctx) => {
  if (ctx.message.caption && !isNaN(ctx.message.caption)) {
    const amount = parseInt(ctx.message.caption);
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const res = await pool.query(
      'INSERT INTO payments (user_id, amount, photo_id) VALUES ($1, $2, $3) RETURNING id',
      [ctx.from.id, amount, photoId]
    );

    ctx.reply("✅ So'rovingiz adminga yuborildi. Tasdiqlanishini kuting.");

    // Adminga xabar yuborish
    bot.telegram.sendPhoto(ADMIN_ID, photoId, {
      caption: `📩 **Yangi to'lov so'rovi!**\n\n👤 Foydalanuvchi: ${ctx.from.id}\n💰 Summa: ${amount.toLocaleString()} UZS\n🆔 To'lov ID: #${res.rows[0].id}`,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Tasdiqlash', `approve_${res.rows[0].id}_${ctx.from.id}_${amount}`)],
        [Markup.button.callback('❌ Rad etish', `reject_${res.rows[0].id}_${ctx.from.id}`)]
      ])
    });
  } else {
    ctx.reply("⚠️ Iltimos, rasmni tagiga (izoh qismiga) faqat to'lov summasini (masalan: 50000) yozib yuboring!");
  }
});

// Admin tasdiqlashi (Callback Query)
bot.action(/approve_(\d+)_(\d+)_(\d+)/, async (ctx) => {
  const [_, payId, userId, amount] = ctx.match;
  await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [amount, userId]);
  await pool.query("UPDATE payments SET status = 'approved' WHERE id = $1", [payId]);

  bot.telegram.sendMessage(userId, `🚀 Tabriklaymiz! To'lovingiz tasdiqlandi. Balansingizga ${parseInt(amount).toLocaleString()} UZS qo'shildi.`);
  ctx.editMessageCaption(`✅ To'lov #${payId} tasdiqlandi!`);
});

// --- 🛠 ADMIN UCHUN KARTA BOSHQARUVI ---
bot.command('addcard', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("Format: /addcard [karta_raqami] [egasi_ismi]");
  
  const cardNumber = parts[1];
  const ownerName = parts.slice(2).join(' ');
  
  await pool.query('INSERT INTO cards (card_number, owner_name) VALUES ($1, $2)', [cardNumber, ownerName]);
  ctx.reply("✅ Yangi karta muvaffaqiyatli qo'shildi!");
});

// --- 🌐 WEB APP API ---
app.get('/api/user/:id', async (req, res) => {
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [req.params.id]);
  res.json(user.rows[0] || { error: 'Not found' });
});

// Render uchun sog'liqni tekshirish
app.get('/', (req, res) => res.send('Rich Omad Server is Live!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  bot.launch();
});
