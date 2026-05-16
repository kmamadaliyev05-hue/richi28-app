require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// Tizim o'zgaruvchilari
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID; // Masalan: 6137845806
const WEB_APP_URL = process.env.WEB_APP_URL || "https://sizning-saytingiz.vercel.app"; 

// PostgreSQL Baza ulanishi
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Yashirin g'olib uchun vaqtinchalik xotira
let manualWinnerId = null;

// ==========================================
// 1. MA'LUMOTLAR BAZASINI AVTOMAT YARATISH
// ==========================================
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                username TEXT,
                balance INT DEFAULT 0,
                welcome_ticket BOOLEAN DEFAULT FALSE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                owner_id BIGINT REFERENCES users(telegram_id),
                ticket_code TEXT UNIQUE,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS active_cards (
                id SERIAL PRIMARY KEY,
                card_details TEXT
            );
        `);
        
        // Agar to'lov kartalari bo'sh bo'lsa, test uchun bitta qo'shamiz
        const cards = await pool.query("SELECT * FROM active_cards");
        if (cards.rowCount === 0) {
            await pool.query("INSERT INTO active_cards (card_details) VALUES ('💳 8600 0000 0000 0000 | RICH OMAD ADMIN')");
        }
        console.log("✅ Baza va jadvallar muvaffaqiyatli tayyorlandi!");
    } catch (err) {
        console.error("❌ Baza yaratishda xato:", err);
    }
}
setupDatabase();

// ==========================================
// 2. FOYDALANUVCHI INTERFEYSI (ONBOARDING)
// ==========================================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || "Foydalanuvchi";

    try {
        const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
        
        if (user.rowCount === 0) {
            // Yangi foydalanuvchini bazaga qo'shish va Welcome Ticket berish
            await pool.query('INSERT INTO users (telegram_id, username, welcome_ticket) VALUES ($1, $2, TRUE)', [userId, username]);
            const ticketCode = 'WLCM-' + crypto.randomBytes(3).toString('hex').toUpperCase();
            await pool.query('INSERT INTO tickets (owner_id, ticket_code) VALUES ($1, $2)', [userId, ticketCode]);
            
            ctx.replyWithHTML(
                `👑 <b>RICH OMAD</b> platformasiga xush kelibsiz!\n\n` +
                `🎁 Sizga 1 ta <b>BEPUL</b> chipta taqdim etildi: <code>${ticketCode}</code>\n\n` +
                `Premium darajadagi shaffof tizim orqali jekpot yutib oling. O'yinni boshlang!`,
                Markup.inlineKeyboard([
                    [Markup.button.webApp("🎰 O'yinni boshlash", WEB_APP_URL)]
                ])
            );
            
            // Asosiy menyu tugmalari
            ctx.reply("👇 Asosiy menyu:", Markup.keyboard([
                ['💰 Balansni to\'ldirish', '🎫 Mening chiptalarim'],
                ['🚀 Isbotlar & Natijalar', '📞 Qo\'llab-quvvatlash']
            ]).resize());

        } else {
            // Eski foydalanuvchiga faqat Web App tugmasi
            ctx.replyWithHTML("👑 <b>RICH OMAD</b> o'yin paneliga kiring:", 
                Markup.inlineKeyboard([
                    [Markup.button.webApp("🎰 O'yinni boshlash", WEB_APP_URL)]
                ])
            );
        }
    } catch (error) {
        console.error("Start komandasida xato:", error);
        ctx.reply("Tizimda xatolik yuz berdi. Iltimos keyinroq urinib ko'ring.");
    }
});

bot.hears('💰 Balansni to\'ldirish', async (ctx) => {
    try {
        const res = await pool.query("SELECT card_details FROM active_cards LIMIT 1");
        if (res.rowCount > 0) {
            ctx.reply(`💳 To'lov uchun asosiy karta:\n\n<code>${res.rows[0].card_details}</code>\n\nTo'lovdan so'ng chekni adminga yuboring.`);
        } else {
            ctx.reply("❌ Hozircha faol kartalar yo'q. Adminga murojaat qiling.");
        }
    } catch (error) {
        ctx.reply("Xatolik yuz berdi.");
    }
});

bot.hears('🎫 Mening chiptalarim', async (ctx) => {
    try {
        const res = await pool.query("SELECT ticket_code FROM tickets WHERE owner_id = $1 AND status = 'active'", [ctx.from.id]);
        if (res.rowCount > 0) {
            let chiptalar = res.rows.map(t => `🎫 <code>${t.ticket_code}</code>`).join('\n');
            ctx.reply(`Sizning faol chiptalaringiz:\n\n${chiptalar}`);
        } else {
            ctx.reply("Sizda hozircha faol chiptalar yo'q.");
        }
    } catch (error) {
        ctx.reply("Ma'lumot topilmadi.");
    }
});

// ==========================================
// 3. ADMIN PANEL VA YASHIRIN RNG LOGIKASI
// ==========================================
bot.command('admin', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return ctx.reply("❌ Sizda admin huquqi yo'q!");
    ctx.reply(
        "🛠 Admin Panelga xush kelibsiz.\n\n" +
        "Boshqaruv buyruqlari:\n" +
        "/setwinner <ID> - Keyingi g'olibni belgilash\n" +
        "/roll - O'yinni aylantirish (G'olibni aniqlash)"
    );
});

bot.command('setwinner', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply("Iltimos, ID ni kiriting: /setwinner 123456789");
    
    manualWinnerId = args[1];
    ctx.reply(`🤫 Keyingi o'yin g'olibi sozlandi: ${manualWinnerId}`);
});

bot.command('roll', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;
    
    try {
        let winnerId = null;
        let winTicket = null;

        if (manualWinnerId) {
            // Admin belgilagan yashirin g'olib
            winnerId = manualWinnerId;
            ctx.reply(`👑 Yashirin RNG ishladi: G'olib ID ${winnerId}`);
            manualWinnerId = null; // Tozalash
        } else {
            // Sof randomizatsiya
            const result = await pool.query("SELECT owner_id, ticket_code FROM tickets WHERE status = 'active'");
            if (result.rowCount === 0) return ctx.reply("Hozircha faol chiptalar yo'q!");
            
            const randomIndex = crypto.randomInt(0, result.rowCount);
            winnerId = result.rows[randomIndex].owner_id;
            winTicket = result.rows[randomIndex].ticket_code;
            ctx.reply(`🎰 Sof RNG orqali g'olib aniqlandi: ${winnerId} | Chipta: ${winTicket}`);
        }

        // G'olibga xabar yuborish
        bot.telegram.sendMessage(winnerId, "🎉 TABRIKLAYMIZ! Siz RICH OMAD Jekpotini yutdingiz!\n\n⏳ Yutuqni tasdiqlash uchun 10 daqiqa ichida o'zingizni videoga olib (kruglyash) shu botga yuboring!");
        
    } catch (error) {
        ctx.reply("❌ Xatolik yuz berdi: " + error.message);
    }
});

// ==========================================
// 4. WEB APP UCHUN API (EXPRESS SERVER)
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

// Botni Renderda "Live" ushlab turish uchun
app.get('/', (req, res) => {
    res.send('👑 Rich Omad Bot is Running Premium Mode!');
});

// Web App foydalanuvchi ma'lumotlarini olishi uchun API endpoint
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        const tickets = await pool.query("SELECT COUNT(*) FROM tickets WHERE owner_id = $1 AND status = 'active'", [userId]);
        
        res.json({ 
            balance: user.rows[0]?.balance || 0, 
            activeTickets: parseInt(tickets.rows[0]?.count || 0) 
        });
    } catch (error) {
        res.status(500).json({ error: "Server xatosi" });
    }
});

// ==========================================
// 5. ISHGA TUSHIRISH
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    bot.launch();
    console.log(`🚀 Premium Tizim ${PORT}-portda ishga tushdi va Bot Live holatda!`);
});

// Botni bexosdan o'chib qolishdan himoya
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
