sendMessage(msg.chat.id, "✅ Now tracking London weather markets!");
  checkWeatherMarket("london");
});

bot.onText(/\/alert nyc/i, msg => {
  tracking.nyc = true;
  bot.sendMessage(msg.chat.id, "✅ Now tracking NYC weather markets!");
  checkWeatherMarket("nyc");
});

bot.onText(/\/stop london/i, msg => {
  tracking.london = false;
  bot.sendMessage(msg.chat.id, "⏹ Stopped tracking London.");
});

bot.onText(/\/stop nyc/i, msg => {
  tracking.nyc = false;
  bot.sendMessage(msg.chat.id, "⏹ Stopped tracking NYC.");
});

bot.onText(/\/current london/i, msg => { checkWeatherMarket("london"); });
bot.onText(/\/current nyc/i, msg => { checkWeatherMarket("nyc"); });

bot.onText(/\/resolve/i, msg => {
  let messages = [];
  ["london","nyc"].forEach(station => {
    if (reportedResolution[station]) messages.push(`${station.toUpperCase()} resolved: ${lastPrices[station].resolved || "Unknown"}`);
    else messages.push(`${station.toUpperCase()} not resolved yet`);
  });
  bot.sendMessage(msg.chat.id, messages.join("\n"));
});

bot.onText(/\/streak london/i, msg => {
  if (streaks.london.length === 0) return bot.sendMessage(msg.chat.id, "No streak data yet for London.");
  let message = "🏆 London top winners (last 2 weeks):\n";
  streaks.london.forEach(s => message += `${s.date}: ${s.winner}\n`);
  bot.sendMessage(msg.chat.id, message);
});

bot.onText(/\/streak nyc/i, msg => {
  if (streaks.nyc.length === 0) return bot.sendMessage(msg.chat.id, "No streak data yet for NYC.");
  let message = "🏆 NYC top winners (last 2 weeks):\n";
  streaks.nyc.forEach(s => message += `${s.date}: ${s.winner}\n`);
  bot.sendMessage(msg.chat.id, message);
});

bot.onText(/\/help/i, msg => {
  const helpMessage = `
Available commands:
/alert london - Start tracking London
/alert nyc - Start tracking NYC
/stop london - Stop tracking London
/stop nyc - Stop tracking NYC
/current london - Show current leading options London
/current nyc - Show current leading options NYC
/streak london - Show recent winners streak London
/streak nyc - Show recent winners streak NYC
/resolve - Show resolved outcome if available
/help - Show this menu
  `;
  bot.sendMessage(msg.chat.id, helpMessage);
  sendCommandButtons(msg.chat.id);import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import express from "express";

// Telegram environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });

// Express for /ping
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/ping", (req, res) => res.send("pong"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Polling error handler
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.response?.description.includes("409")) {
    console.log("⚠️ Polling conflict detected. Wait a few seconds and restart the bot.");
  } else {
    console.error("Polling error:", err);
  }
});

// Tracking states
let tracking = { london: false, nyc: false };
let lastPrices = { london: {}, nyc: {} };
let reportedResolution = { london: false, nyc: false };
let streaks = { london: [], nyc: [] };

// Helper: fetch today’s market slug
async function findLatestWeatherMarket(station) {
  const res = await fetch("https://gamma-api.polymarket.com/markets");
  const data = await res.json();

  const today = new Date();
  const day = today.getDate();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const month = monthNames[today.getMonth()];

  const markets = data.filter(m =>
    m.question.toLowerCase().includes(station.toLowerCase()) &&
    m.question.includes(`${day}`) &&
    m.question.includes(month)
  );

  markets.sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
  return markets[0]?.slug;
}

// Check top 3 price changes
async function checkWeatherMarket(station) {
  if (!tracking[station]) return;

  const slug = await findLatestWeatherMarket(station);
  if (!slug) return;

  const res = await fetch(`https://gamma-api.polymarket.com/market/${slug}`);
  const data = await res.json();
  if (!data.outcomes) return;

  const topOutcomes = data.outcomes
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  let changes = [];
  topOutcomes.forEach(o => {
    const { name, price } = o;
    const percent = (price * 100).toFixed(0) + "%";
    const cents = (price).toFixed(2);

    const last = lastPrices[station][name];
    if (last === undefined) {
      changes.push(`${name} • ${percent} (${cents}¢)`);
    } else if (last !== price) {
      const arrow = price > last ? "↑" : "↓";
      changes.push(`${name} ${arrow} ${percent} (${cents}¢)`);
    }
    lastPrices[station][name] = price;
  });

  if (changes.length > 0) {
    const message = [${station.toUpperCase()}] ${changes.join(", ")};
    bot.sendMessage(chatId, message);
  }

  if (data.resolvedOutcome && !reportedResolution[station]) {
    const resolved = data.resolvedOutcome.name;
    const message = ✅ [${station.toUpperCase()}] Resolved: ${resolved};
    bot.sendMessage(chatId, message);
    reportedResolution[station] = true;
    lastPrices[station].resolved = resolved;

    streaks[station].push({ date: new Date().toISOString().slice(0,10), winner: resolved });
    if (streaks[station].length > 14) streaks[station] = streaks[station].slice(-14);
  }
}

// Polling every 30s
setInterval(() => checkWeatherMarket("london"), 30*1000);
setInterval(() => checkWeatherMarket("nyc"), 30*1000);

// Helper: send clickable buttons
function sendCommandButtons(chatId) {
  const opts = {
    reply_markup: {
      keyboard: [
        ["/alert london", "/alert nyc"],
        ["/stop london", "/stop nyc"],
        ["/current london", "/current nyc"],
        ["/streak london", "/streak nyc"],
        ["/resolve", "/help"]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  bot.sendMessage(chatId, "Select a command:", opts);
}

// Commands
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, "Hi! Use buttons or type commands to start tracking.");
  sendCommandButtons(msg.chat.id);
});

bot.onText(/\/alert london/i, msg => {
  tracking.london = true;
  bot.
});
