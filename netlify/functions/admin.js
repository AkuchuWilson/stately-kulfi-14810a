// Academy Admin API. Only signed-in admins (ADMIN_EMAILS) can use it.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional ADMIN_EMAILS (comma separated)
const ADMINS = (process.env.ADMIN_EMAILS || "globalbrightpath1@gmail.com,akuchuwilson@yahoo.com").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const KEYS = ["foundations","floor","fit","pathway","cfs","manager","master","member","enterprise","bpg"];
const svc = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" });
async function sb(path, opts) {
  const r = await fetch(process.env.SUPABASE_URL + path, opts || { headers: svc() });
  const t = await r.text();
  if (!r.ok) throw new Error(r.status + " " + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const out = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return out(405, { error: "Method not allowed" });
  try {
    const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return out(401, { error: "Sign in first." });
    const me = await sb("/auth/v1/user", { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } });
    if (!me || !me.email || !ADMINS.includes(me.email.toLowerCase())) return out(403, { error: "This account is not an Academy admin." });
    const body = JSON.parse(event.body || "{}");

    if (body.action === "list") {
      const users = (await sb("/auth/v1/admin/users?per_page=1000")).users || [];
      const ents = await sb("/rest/v1/entitlements?select=id,user_id,kind,key,status,source,created_at&order=created_at.desc");
      const prog = await sb("/rest/v1/progress?select=user_id,state,updated_at");
      const pmap = {}; prog.forEach(p => {
        const s = p.state || {}, done = Object.keys(s.done || {}).filter(k => s.done[k]).length;
        pmap[p.user_id] = { topics: done, enrolled: Object.keys(s.enrolled || {}), track: s.track || "", updated: p.updated_at };
      });
      return out(200, { me: me.email, users: users.map(u => ({
        id: u.id, email: u.email, name: (u.user_metadata || {}).name || "", org: (u.user_metadata || {}).organisation || "", role: (u.user_metadata || {}).role || "",
        created: u.created_at, last: u.last_sign_in_at, confirmed: !!u.email_confirmed_at,
        progress: pmap[u.id] || { topics: 0, enrolled: [], track: "", updated: null },
        access: ents.filter(e => e.user_id === u.id)
      })) });
    }
    if (body.action === "grant") {
      if (!/^[0-9a-f-]{36}$/i.test(body.user_id || "") || !KEYS.includes(body.key)) return out(400, { error: "Invalid request." });
      const kind = ["member", "enterprise", "bpg"].includes(body.key) ? "plan" : "programme";
      await sb("/rest/v1/entitlements", { method: "POST", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify({ user_id: body.user_id, kind, key: body.key, status: "active", source: "manual" }) });
      return out(200, { ok: true });
    }
    if (body.action === "revoke" || body.action === "restore") {
      if (!/^\d+$/.test(String(body.id || ""))) return out(400, { error: "Invalid request." });
      await sb("/rest/v1/entitlements?id=eq." + body.id, { method: "PATCH", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify({ status: body.action === "revoke" ? "canceled" : "active" }) });
      return out(200, { ok: true });
    }
    if (body.action === "leads") {
      const leads = await sb("/rest/v1/leads?select=*&order=created_at.desc&limit=2000");
      return out(200, { leads });
    }
    if (body.action === "lead") {
      if (!/^\d+$/.test(String(body.id || "")) || !["new","contacted","won","lost"].includes(body.status)) return out(400, { error: "Invalid request." });
      const patch = { status: body.status }; if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
      await sb("/rest/v1/leads?id=eq." + body.id, { method: "PATCH", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify(patch) });
      return out(200, { ok: true });
    }
    return out(400, { error: "Unknown action." });
  } catch (e) {
    return out(500, { error: "Admin service error. Please try again." });
  }
};
