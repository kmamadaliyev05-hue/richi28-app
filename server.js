const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 🗄 POSTGRESQL BAZA BILAN BOG'LANISH ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Cloud provayderlar uchun shart
});

// Admin ID sini Environment Variable orqali olamiz
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// --- 🛠 BAZA JADVALLARINI AVTOMAT YARATISH ---
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        tickets INTEGER DEFAULT 0,
        last_card_index INTEGER DEFAULT 0
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
        amount INTEGER,
        photo_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Ma\'lumotlar bazasi tayyor!');
  } catch (err) {
    console.error('❌ Baza yaratishda xato:', err);
  }
};
initDB();

// --- 💳 KARTA ROTATSIYASI LOGIKASI ---
async function getNextCardForUser(userId) {
  const cardsRes = await pool.query('SELECT * FROM cards WHERE is_active = TRUE ORDER BY id ASC');
  if (cardsRes.rows.length === 0) return null;

  const userRes = await pool.query('SELECT last_card_index FROM users WHERE telegram_id = $1', [userId]);
  const currentIndex = userRes.rows[0]?.last_card_index || 0;
  
  const nextIndex = (currentIndex + 1) % cardsRes.rows.length;
  await pool.query('UPDATE users SET last_card_index = $1 WHERE telegram_id = $2', [nextIndex, userId]);
  
  return cardsRes.rows[nextIndex];
}

// --- 🤖 BOT KOMANDALARI ---

bot.start(async (ctx) => {
  const { id, username } = ctx.from;
  try {
    await pool.query(
      'INSERT INTO users (telegram_id, username) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING',
      [id, username || 'user']
    );
    ctx.reply(`👑 RICH OMAD loyihasiga xush kelibsiz!\n\nPastdagi tugmani bosing va o'yinni boshlang.`, 
      Markup.keyboard([['💰 Balansni to\'ldirish'], ['🎰 O\'yinni boshlash']]).resize()
    );
  } catch (err) { console.error(err); }
});

bot.hears('💰 Balansni to\'ldirish', async (ctx) => {
  const card = await getNextCardForUser(ctx.from.id);
  if (!card) return ctx.reply("❌ Hozircha faol kartalar yo'q. Adminga murojaat qiling.");

  ctx.replyWithMarkdown(
    `💳 *To'lov qilish uchun karta ma'lumotlari:*\n\n` +
    `🔢 Karta: \`${card.card_number}\`\n` +
    `👤 Ega: *${card.owner_name}*\n\n` +
    `⚠️ *Qadamlar:* \n1. To'lovni amalga oshiring.\n2. Chekni (skrinshotni) shu yerga yuboring.\n3. Rasm ostiga (caption) summani yozing.`
  );
});

// To'lovni qabul qilish (Foto + Caption)
bot.on('photo', async (ctx) => {
  const amount = parseInt(ctx.message.caption);
  if (isNaN(amount)) {
    return ctx.reply("⚠️ Xato! Rasmni tagiga faqat summani raqam bilan yozing (masalan: 50000)");
  }

  const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  
  try {
    const res = await pool.query(
      'INSERT INTO payments (user_id, amount, photo_id) VALUES ($1, $2, $3) RETURNING id',
      [ctx.from.id, amount, photoId]
    );

    ctx.reply("⏳ To'lovingiz adminga yuborildi. Tasdiqlashni kuting...");

    // Adminga xabar yuborish
    bot.telegram.sendPhoto(ADMIN_ID, photoId, {
      caption: `📩 **Yangi to'lov!**\n👤 User ID: ${ctx.from.id}\n💰 Summa: ${amount.toLocaleString()} UZS\n🆔 ID: #${res.rows[0].id}`,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Tasdiqlash', `approve_${res.rows[0].id}_${ctx.from.id}_${amount}`)],
        [Markup.button.callback('❌ Rad etish', `reject_${res.rows[0].id}`)]
      ])
    });
  } catch (err) { console.error(err); }
});

// Admin tasdiqlash tugmasi
bot.action(/approve_(\d+)_(\d+)_(\d+)/, async (ctx) => {
  const [_, payId, userId, amount] = ctx.match;
  try {
    await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [amount, userId]);
    await pool.query("UPDATE payments SET status = 'approved' WHERE id = $1", [payId]);

    bot.telegram.sendMessage(userId, `🚀 Tabriklaymiz! To'lovingiz tasdiqlandi.\nBalansingizga +${parseInt(amount).toLocaleString()} UZS qo'shildi.`);
    ctx.answerCbQuery("Tasdiqlandi ✅");
    ctx.editMessageCaption(`✅ To'lov #${payId} muvaffaqiyatli qabul qilindi.`);
  } catch (err) { console.error(err); }
});

// --- 🛠 ADMIN KARTALARNI BOSHQARISH ---
bot.command('addcard', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("Format: /addcard [raqam] [ism]");
  
  const num = parts[1];
  const name = parts.slice(2).join(' ');
  await pool.query('INSERT INTO cards (card_number, owner_name) VALUES ($1, $2)', [num, name]);
  ctx.reply("✅ Karta qo'shildi!");
});

// --- 🌐 WEB APP UCHUN API ---
app.get('/api/user/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [req.params.id]);
    res.json(result.rows[0] || { error: 'Topilmadi' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Render uyg'oq turishi uchun
app.get('/', (req, res) => res.send('Rich Omad Bot is Working...'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  bot.launch().then(() => console.log('🤖 Bot ishga tushdi!'));
});

// Xatoliklarni ushlash
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
