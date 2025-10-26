import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token, { polling: true });

// Polling error handler
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.response?.description.includes("409")) {
    console.log("⚠️ Polling conflict detected. Wait a few seconds and restart the bot.");
  } else {
    console.error("Polling error:", err);
  }
});

// Tracking states per station
let tracking = { london: false, nyc: false };

// Store last prices per station
let lastPrices = { london: {}, nyc: {} };

// Prevent duplicate resolution alerts
let reportedResolution = { london: false, nyc: false };

// Store current slugs
let currentSlug = { london: null, nyc: null };

// Fetch latest market slug for a station
async function updateSlug(station) {
  const res = await fetch("https://gamma-api.polymarket.com/markets");
  const data = await res.json();

  const markets = data.filter(m =>
    m.question.toLowerCase().includes(station.toLowerCase()) &&
    m.question.toLowerCase().includes("highest temperature")
  );

  markets.sort((a, b) => new Date(b.endDate  Date.now()) - new Date(a.endDate  Date.now()));

  currentSlug[station] = markets[0]?.slug || null;

  if (currentSlug[station]) console.log(`Updated slug for ${station}: ${currentSlug[station]}`);
  else console.log(`No market found for ${station} today`);
}

// Initial slug fetch
["london", "nyc"].forEach(station => updateSlug(station));

// Daily slug refresh at 00:05 local time
function scheduleDailySlugUpdate() {
  const now = new Date();
  const millisTillMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0) - now;

  setTimeout(() => {
    ["london", "nyc"].forEach(station => updateSlug(station));
    scheduleDailySlugUpdate();
  }, millisTillMidnight);
}

scheduleDailySlugUpdate();

// Fetch market data for slug
async function fetchMarket(slug) {
  const res = await fetch(`https://gamma-api.polymarket.com/market/${slug}`);
  const data = await res.json();
  return data;
}

// Get top 3 outcomes formatted
function getTop3(outcomes) {
  return outcomes
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map(o => {
      const percent = (o.price * 100).toFixed(0) + "%";
      const cents = (o.price).toFixed(2);
      return ${o.name} • ${percent} (${cents}¢);
    });
}

// Check price changes for a station
async function checkWeatherMarket(station) {
  if (!tracking[station]) return;
  const slug = currentSlug[station];
  if (!slug) return;

  const data = await fetchMarket(slug);
  if (!data.outcomes) return;

  let changes = [];
  data.outcomes.forEach(o => {
    const last = lastPrices[station][o.name];
    if (last !== undefined && last !== o.price) {
      const arrow = o.price > last ? "↑" : "↓";
      const percent = (o.price * 100).toFixed(0) + "%";
      const cents = (o.price).toFixed(2);
      changes.push(`${o.name} ${arrow} ${percent} (${cents}¢)`);
    }
    lastPrices[station][o.name] = o.price;
  });

  if (changes.length > 0) {
    const topChanges = changes.slice(0, 3);
    const message = [${station.toUpperCase()}] ${topChanges.join(", ")};
    bot.sendMessage(chatId, message);
  }

  // Market resolved alert
  if (data.resolvedOutcome && !reportedResolution[station]) {
    const resolved = data.resolvedOutcome.name;
    const message = ✅ [${station.toUpperCase()}] ${data.endDate.slice(0,10)}: ${resolved} (highest temp recorded);
    bot.sendMessage(chatId, message);
    reportedResolution[station] = true;
  }
}

// Run both stations every 30 seconds
setInterval(() => checkWeatherMarket("london"), 30*1000);
setInterval(() => checkWeatherMarket("nyc"), 30*1000);

// Telegram commands
bot.onText(/\/start/, msg => {
  const buttons = [
    [{ text: "/alert london" }, { text: "/alert nyc" }],
    [{ text: "/stop london" }, { text: "/stop nyc" }],[{ text: "/resolve" }, { text: "/streak london" }, { text: "/streak nyc" }],
    [{ text: "/help" }]
  ];
  bot.sendMessage(msg.chat.id, "Hi! Use the buttons below or type commands:", {
    reply_markup: { keyboard: buttons, one_time_keyboard: false, resize_keyboard: true }
  });
});

// /alert commands
bot.onText(/\/alert london/i, msg => {
  tracking.london = true;
  bot.sendMessage(msg.chat.id, "✅ Now tracking London weather markets!");
  checkWeatherMarket("london");
});
bot.onText(/\/alert nyc/i, msg => {
  tracking.nyc = true;
  bot.sendMessage(msg.chat.id, "✅ Now tracking NYC weather markets!");
  checkWeatherMarket("nyc");
});

// /stop commands
bot.onText(/\/stop london/i, msg => {
  tracking.london = false;
  bot.sendMessage(msg.chat.id, "⏹ Stopped tracking London.");
});
bot.onText(/\/stop nyc/i, msg => {
  tracking.nyc = false;
  bot.sendMessage(msg.chat.id, "⏹ Stopped tracking NYC.");
});

// /current commands
bot.onText(/\/current london/i, msg => {
  const slug = currentSlug.london;
  fetchMarket(slug).then(data => {
    if (!data.outcomes) return bot.sendMessage(msg.chat.id, "No market found for London today.");
    const top3 = getTop3(data.outcomes);
    bot.sendMessage(msg.chat.id, `[LONDON] ${top3.join(", ")}`);
  });
});
bot.onText(/\/current nyc/i, msg => {
  const slug = currentSlug.nyc;
  fetchMarket(slug).then(data => {
    if (!data.outcomes) return bot.sendMessage(msg.chat.id, "No market found for NYC today.");
    const top3 = getTop3(data.outcomes);
    bot.sendMessage(msg.chat.id, `[NYC] ${top3.join(", ")}`);
  });
});

// /resolve command
bot.onText(/\/resolve/i, msg => {
  let messages = [];
  ["london", "nyc"].forEach(async station => {
    const slug = currentSlug[station];
    const data = await fetchMarket(slug);
    if (data.resolvedOutcome) {
      messages.push(`✅ [${station.toUpperCase()}] ${data.endDate.slice(0,10)}: ${data.resolvedOutcome.name}`);
    } else {
      messages.push(`[${station.toUpperCase()}] Market not yet resolved`);
    }
    if (messages.length === 2) bot.sendMessage(msg.chat.id, messages.join("\n"));
  });
});

// /streak commands (placeholder, implement your 1-2 week tracking logic)
bot.onText(/\/streak london/i, msg => {
  bot.sendMessage(msg.chat.id, "Streak data for London: (functionality to be implemented)");
});
bot.onText(/\/streak nyc/i, msg => {
  bot.sendMessage(msg.chat.id, "Streak data for NYC: (functionality to be implemented)");
});

// /help command
bot.onText(/\/help/i, msg => {
  bot.sendMessage(msg.chat.id, `Available commands:
/alert london - start tracking London
/alert nyc - start tracking NYC
/stop london - stop tracking London
/stop nyc - stop tracking NYC
/current london - show current top 3 London options
/current nyc - show current top 3 NYC options
/resolve - show resolved outcome
/streak london - show streak for London
/streak nyc - show streak for NYC
/help - show this help`);
});
    [{ text: "/current london" }, { text: "/current nyc" }],
