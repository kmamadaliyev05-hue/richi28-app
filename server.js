require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// BAZANI AVTOMATIK SOZLACH (PRO DARAZA)
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, balance INT DEFAULT 0);
            CREATE TABLE IF NOT EXISTS active_cards (id SERIAL PRIMARY KEY, card_details TEXT);
        `);
        // Test uchun bitta karta qo'shib qo'yamiz (agar baza bo'sh bo'lsa)
        const res = await pool.query("SELECT * FROM active_cards");
        if (res.rowCount === 0) {
            await pool.query("INSERT INTO active_cards (card_details) VALUES ('💳 8600 0000 0000 0000 | Kamronbek M.')");
        }
        console.log("✅ Baza va kartalar tayyor!");
    } catch (err) { console.error("❌ Baza xatosi:", err); }
}
setupDatabase();

bot.start((ctx) => {
    ctx.reply("👑 RICH OMAD loyihasiga xush kelibsiz!", 
    Markup.keyboard([['💰 Balansni to\'ldirish'], ['🎰 O\'yinni boshlash']]).resize());
});

bot.hears('💰 Balansni to\'ldirish', async (ctx) => {
    const res = await pool.query("SELECT card_details FROM active_cards LIMIT 1");
    if (res.rowCount > 0) {
        ctx.reply(`To'lov uchun karta:\n\n${res.rows[0].card_details}\n\nTo'lovdan so'ng chekni adminga yuboring.`);
    } else {
        ctx.reply("❌ Hozircha faol kartalar yo'q. Adminga murojaat qiling.");
    }
});

// Render uchun Express (uyg'oq saqlash uchun)
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(process.env.PORT || 3000, () => {
    bot.launch();
    console.log("🚀 Bot Live!");
});
