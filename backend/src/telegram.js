const TELEGRAM_API = "https://api.telegram.org";

export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram not configured (missing env vars) -- skipping alert:", text);
    return { skipped: true };
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const json = await res.json();
    if (!json.ok) console.error("Telegram send failed:", json.description);
    return json;
  } catch (e) {
    console.error("Telegram send error:", e.message);
    return { ok: false, error: e.message };
  }
}
