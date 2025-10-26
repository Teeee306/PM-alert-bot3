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
let lastPrices = { london: {}, nyc: {} };
let reportedResolution = { london: false, nyc: false };
let currentSlug = { london: null, nyc: null };

// Update slug for a station
async function updateSlug(station) {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/markets");
    const data = await res.json();

    const markets = data.filter(m =>
      m.question.toLowerCase().includes(station.toLowerCase()) &&
      m.question.toLowerCase().includes("highest temperature")
    );

    markets.sort((a, b) => new Date(b.endDate  Date.now()) - new Date(a.endDate  Date.now()));

    currentSlug[station] = markets[0]?.slug || null;
    console.log(currentSlug[station] ? Updated slug for ${station}: ${currentSlug[station]} : `No market found for ${station} today`);
  } catch (e) {
    console.log(`Failed to update slug for ${station}:`, e.message);
  }
}

// Initial slug fetch
["london", "nyc"].forEach(station => updateSlug(station));

// Daily slug refresh at 00:05
function scheduleDailySlugUpdate() {
  const now = new Date();
  const millisTillMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0) - now;

  setTimeout(() => {
    ["london", "nyc"].forEach(station => updateSlug(station));
    scheduleDailySlugUpdate();
  }, millisTillMidnight);
}

scheduleDailySlugUpdate();

// Fetch market safely
async function fetchMarket(slug) {
  if (!slug) return null;
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/market/${slug}`);
    if (!res.ok) {
      console.log(`Error fetching market for slug ${slug}: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`Failed to parse JSON for slug ${slug}:`, e.message);
    return null;
  }
}

// Get top 3 options
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

// Check price changes
async function checkWeatherMarket(station) {
  if (!tracking[station]) return;
  const slug = currentSlug[station];
  const data = await fetchMarket(slug);
  if (!data || !data.outcomes) return;

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
    bot.sendMessage(chatId, `[${station.toUpperCase()}] ${topChanges.join(", ")}`);
  }

  if (data.resolvedOutcome && !reportedResolution[station]) {
    const resolved = data.resolvedOutcome.name;
    bot.sendMessage(chatId, `✅ [${station.toUpperCase()}] ${data.endDate.slice(0,10)}: ${resolved} (highest temp recorded)`);
    reportedResolution[station] = true;
  }
}

// Run checks every 30s
setInterval(() => checkWeatherMarket("london"), 30*1000);
setInterval(() => checkWeatherMarket("nyc"), 30*1000);

// Telegram commands with msg.text safety check
bot.onText(/\/start/, msg => {
  if (!msg.text) return;
  const buttons = [
    [{ text: "/alert london" }, { text: "/alert nyc" }],[{ text: "/stop london" }, { text: "/stop nyc" }],
    [{ text: "/current london" }, { text: "/current nyc" }],
    [{ text: "/resolve" }, { text: "/streak london" }, { text: "/streak nyc" }],
    [{ text: "/help" }]
  ];
  bot.sendMessage(msg.chat.id, "Hi! Use the buttons below or type commands:", {
    reply_markup: { keyboard: buttons, one_time_keyboard: false, resize_keyboard: true }
  });
});

bot.onText(/\/alert london/i, msg => { if (!msg.text) return; tracking.london = true; bot.sendMessage(msg.chat.id, "✅ Now tracking London!"); checkWeatherMarket("london"); });
bot.onText(/\/alert nyc/i, msg => { if (!msg.text) return; tracking.nyc = true; bot.sendMessage(msg.chat.id, "✅ Now tracking NYC!"); checkWeatherMarket("nyc"); });
bot.onText(/\/stop london/i, msg => { if (!msg.text) return; tracking.london = false; bot.sendMessage(msg.chat.id, "⏹ Stopped tracking London."); });
bot.onText(/\/stop nyc/i, msg => { if (!msg.text) return; tracking.nyc = false; bot.sendMessage(msg.chat.id, "⏹ Stopped tracking NYC."); });

bot.onText(/\/current london/i, async msg => {
  if (!msg.text) return;
  const data = await fetchMarket(currentSlug.london);
  if (!data || !data.outcomes) return bot.sendMessage(msg.chat.id, "No market found for London today.");
  bot.sendMessage(msg.chat.id, `[LONDON] ${getTop3(data.outcomes).join(", ")}`);
});
bot.onText(/\/current nyc/i, async msg => {
  if (!msg.text) return;
  const data = await fetchMarket(currentSlug.nyc);
  if (!data || !data.outcomes) return bot.sendMessage(msg.chat.id, "No market found for NYC today.");
  bot.sendMessage(msg.chat.id, `[NYC] ${getTop3(data.outcomes).join(", ")}`);
});

bot.onText(/\/resolve/i, async msg => {
  if (!msg.text) return;
  const messages = [];
  for (let station of ["london","nyc"]) {
    const data = await fetchMarket(currentSlug[station]);
    if (data?.resolvedOutcome) messages.push(`✅ [${station.toUpperCase()}] ${data.endDate.slice(0,10)}: ${data.resolvedOutcome.name}`);
    else messages.push(`[${station.toUpperCase()}] Market not yet resolved`);
  }
  bot.sendMessage(msg.chat.id, messages.join("\n"));
});

bot.onText(/\/streak london/i, msg => { if (!msg.text) return; bot.sendMessage(msg.chat.id, "Streak data for London: (functionality to implement)"); });
bot.onText(/\/streak nyc/i, msg => { if (!msg.text) return; bot.sendMessage(msg.chat.id, "Streak data for NYC: (functionality to implement)"); });

bot.onText(/\/help/i, msg => {
  if (!msg.text) return;
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
