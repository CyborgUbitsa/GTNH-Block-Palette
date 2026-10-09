// Cloudflare Worker that receives texture reports from the palette site and
// forwards them to a Discord webhook, so the webhook URL never reaches the
// browser.
//
// Deploy:  npx wrangler deploy worker/report-worker.js --name gtnh-palette-report
//          npx wrangler secret put DISCORD_WEBHOOK   (paste the webhook URL)
// Optional: set ALLOWED_ORIGIN to your site's origin (e.g. https://you.github.io)
// Then in site.config.json: "report": { "mode": "worker", "url": "<worker url>" }

const REASONS = new Set(["not_decorative", "wrong_name", "broken_texture", "wrong_mod", "duplicate", "other"]);
const clip = (s, n) => String(s ?? "").slice(0, n);

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

    let r;
    try {
      r = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400, headers: cors });
    }
    if (!REASONS.has(r.reason) || !r.id) return new Response("Bad report", { status: 400, headers: cors });

    const res = await fetch(env.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordMessage(r)),
    });
    return new Response(res.ok ? "ok" : "upstream error", { status: res.ok ? 200 : 502, headers: cors });
  },
};

// Same message format as the site's direct "discord" mode.
function discordMessage(r) {
  return {
    username: "Palette reports",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clip(`Report: ${r.name}`, 250),
      color: 0xd04b3b,
      fields: [
        { name: "Reason", value: clip(r.reasonLabel || r.reason, 200), inline: true },
        { name: "Mod", value: clip(r.mod, 200) || "-", inline: true },
        { name: "Texture id", value: "`" + clip(r.id, 300) + "`" },
        { name: "Comment", value: clip(r.comment, 1000) || "-" },
        { name: "Searched colour", value: clip(r.query, 20) || "-", inline: true },
        { name: "Build", value: clip(r.build, 40) || "-", inline: true },
      ],
    }],
  };
}
