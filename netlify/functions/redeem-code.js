// Redeems the BrightPath Global team access code on the server, with a seat limit.
// Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   TEAM_CODE (your team access code), TEAM_ORG (e.g. BrightPath Global), TEAM_SEATS (e.g. 8)
async function sb(path, opts) {
  const r = await fetch(process.env.SUPABASE_URL + path, opts);
  const t = await r.text();
  if (!r.ok) throw new Error(r.status + " " + t);
  return t ? JSON.parse(t) : null;
}
const svc = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  try {
    const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Sign in first." }) };
    const user = await sb("/auth/v1/user", { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } });
    const body = JSON.parse(event.body || "{}");
    const code = String(body.code || "").trim().toUpperCase();
    const org = String(body.organisation || "");
    if (!process.env.TEAM_CODE || code !== String(process.env.TEAM_CODE).toUpperCase()) return { statusCode: 200, body: JSON.stringify({ ok: false, error: "That code was not recognised." }) };
    const orgRe = new RegExp((process.env.TEAM_ORG || "BrightPath Global").replace(/\s+/g, "\\s*"), "i");
    if (!orgRe.test(org)) return { statusCode: 200, body: JSON.stringify({ ok: false, error: "This code is for " + (process.env.TEAM_ORG || "BrightPath Global") + " members." }) };
    const existing = await sb("/rest/v1/entitlements?select=user_id&key=eq.bpg&source=eq.code&status=eq.active", { headers: svc() });
    if (existing.some(r => r.user_id === user.id)) return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    if (existing.length >= Number(process.env.TEAM_SEATS || 8)) return { statusCode: 200, body: JSON.stringify({ ok: false, error: "All team seats for this code are in use." }) };
    await sb("/rest/v1/entitlements", { method: "POST", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify({ user_id: user.id, kind: "plan", key: "bpg", source: "code", status: "active" }) });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Could not redeem the code right now." }) };
  }
};
