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
    if (body.action === "feedback") {
      const feedback = await sb("/rest/v1/feedback?select=*&order=created_at.desc&limit=2000");
      return out(200, { feedback });
    }
    if (body.action === "fb") {
      if (!/^\d+$/.test(String(body.id || "")) || !["pending","approved","hidden"].includes(body.status)) return out(400, { error: "Invalid request." });
      await sb("/rest/v1/feedback?id=eq." + body.id, { method: "PATCH", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify({ status: body.status }) });
      return out(200, { ok: true });
    }
    /* ===== Academy Perform ===== */
    const P = body.action || "";
    if (P.indexOf("perform_") === 0) {
      const id = (v) => /^\d+$/.test(String(v || "")) ? String(v) : null;
      const ins = (t, row) => sb("/rest/v1/" + t, { method: "POST", headers: Object.assign(svc(), { Prefer: "return=representation" }), body: JSON.stringify(row) });
      const patch = (q, row) => sb("/rest/v1/" + q, { method: "PATCH", headers: Object.assign(svc(), { Prefer: "return=minimal" }), body: JSON.stringify(row) });
      const del = (q) => sb("/rest/v1/" + q, { method: "DELETE", headers: Object.assign(svc(), { Prefer: "return=minimal" }) });
      const users = async () => ((await sb("/auth/v1/admin/users?per_page=1000")).users || []);
      if (P === "perform_overview") {
        const [apps, cohorts, exercises, members, assignments] = await Promise.all([
          sb("/rest/v1/perform_applications?select=*&order=created_at.desc&limit=1000"),
          sb("/rest/v1/perform_cohorts?select=*&order=created_at.desc"),
          sb("/rest/v1/perform_exercises?select=*&order=id"),
          sb("/rest/v1/perform_members?select=*"),
          sb("/rest/v1/perform_assignments?select=*")]);
        const ids = [...new Set(members.map(m => m.user_id))];
        const us = ids.length ? (await users()).filter(u => ids.includes(u.id)) : [];
        const people = {}; us.forEach(u => { people[u.id] = { email: u.email, name: (u.user_metadata || {}).name || "" }; });
        return out(200, { apps, cohorts, exercises, members, assignments, people });
      }
      if (P === "perform_cohort_detail") {
        const c = id(body.id); if (!c) return out(400, { error: "Invalid request." });
        const [completions, observations, scorecards] = await Promise.all([
          sb("/rest/v1/perform_completions?select=*,perform_assignments!inner(cohort_id)&perform_assignments.cohort_id=eq." + c),
          sb("/rest/v1/perform_observations?select=*&cohort_id=eq." + c + "&order=created_at.desc"),
          sb("/rest/v1/perform_scorecards?select=*&cohort_id=eq." + c + "&order=week")]);
        return out(200, { completions, observations, scorecards });
      }
      if (P === "perform_app_update") {
        const a = id(body.id); if (!a) return out(400, { error: "Invalid request." });
        const row = {};
        if (body.status) { if (!["new","reviewing","accepted","declined","withdrawn"].includes(body.status)) return out(400, { error: "Invalid status." }); row.status = body.status; }
        if (body.payment_status) { if (!["unpaid","link_sent","waived","refunded"].includes(body.payment_status)) return out(400, { error: "Paid status is only set by a verified Stripe payment." }); row.payment_status = body.payment_status; }
        if (body.enrolment_status) {
          if (!["not_enrolled","enrolled","completed"].includes(body.enrolment_status)) return out(400, { error: "Invalid status." });
          if (body.enrolment_status !== "not_enrolled") {
            const app = (await sb("/rest/v1/perform_applications?select=cohort_id&id=eq." + a))[0];
            const learners = app && app.cohort_id ? await sb("/rest/v1/perform_members?select=user_id&role=eq.learner&cohort_id=eq." + app.cohort_id) : [];
            if (!learners.length) return out(200, { ok: false, error: "Enrolment status changes automatically when you add learners to this application's pilot. Add at least one learner first." });
          }
          row.enrolment_status = body.enrolment_status;
        }
        if (typeof body.admin_notes === "string") row.admin_notes = body.admin_notes.slice(0, 2000);
        await patch("perform_applications?id=eq." + a, row); return out(200, { ok: true });
      }
      if (P === "perform_cohort_create") {
        const start = /^\d{4}-\d{2}-\d{2}$/.test(body.start_date || "") ? body.start_date : null;
        const end = start ? new Date(new Date(start + "T00:00:00Z").getTime() + 29 * 864e5).toISOString().slice(0, 10) : null;
        const cur = /^[A-Z]{3}$/.test(body.currency || "") ? body.currency : "USD";
        const appId = id(body.application_id);
        const r = await ins("perform_cohorts", { name: String(body.name || "Scan-to-Fit pilot").slice(0, 120), organisation: String(body.organisation || "").slice(0, 160), store_name: String(body.store_name || "").slice(0, 160), currency: cur, start_date: start, end_date: end, status: "setup", lessons: ["3.1","3.2","1.4","S1.2","5.1","S3.2","F2.3","F3.3","3.4","S2.2","F2.2","4.4","6.1"], application_id: appId });
        if (appId) await patch("perform_applications?id=eq." + appId, { cohort_id: r[0].id });
        return out(200, { ok: true, cohort: r[0] });
      }
      if (P === "perform_cohort_update") {
        const c = id(body.id); if (!c) return out(400, { error: "Invalid request." });
        const row = {};
        if (body.status && ["setup","active","completed"].includes(body.status)) row.status = body.status;
        if (/^[A-Z]{3}$/.test(body.currency || "")) row.currency = body.currency;
        if (/^\d{4}-\d{2}-\d{2}$/.test(body.start_date || "")) { row.start_date = body.start_date; row.end_date = new Date(new Date(body.start_date + "T00:00:00Z").getTime() + 29 * 864e5).toISOString().slice(0, 10); }
        await patch("perform_cohorts?id=eq." + c, row); return out(200, { ok: true });
      }
      if (P === "perform_member_add") {
        const c = id(body.cohort_id); const role = body.role === "manager" ? "manager" : "learner";
        const email = String(body.email || "").trim().toLowerCase();
        if (!c || !email) return out(400, { error: "Invalid request." });
        const cohort = (await sb("/rest/v1/perform_cohorts?select=*&id=eq." + c))[0]; if (!cohort) return out(404, { error: "Cohort not found." });
        const u = (await users()).find(x => (x.email || "").toLowerCase() === email);
        if (!u) return out(200, { ok: false, error: "No Academy account uses this email yet. Ask the person to create an account first, then add them." });
        const mem = await sb("/rest/v1/perform_members?select=*&cohort_id=eq." + c);
        if (role === "learner" && mem.filter(m => m.role === "learner" && m.user_id !== u.id).length >= 5) return out(200, { ok: false, error: "The pilot includes up to five learners." });
        let paid = true;
        if (cohort.application_id) { const app = (await sb("/rest/v1/perform_applications?select=payment_status&id=eq." + cohort.application_id))[0]; paid = app && ["paid","waived"].includes(app.payment_status); }
        if (!paid) return out(200, { ok: false, error: "Payment has not been confirmed. Record a verified payment, or mark the application as waived, before enrolling people." });
        await sb("/rest/v1/perform_members?on_conflict=cohort_id,user_id", { method: "POST", headers: Object.assign(svc(), { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ cohort_id: Number(c), user_id: u.id, role }) });
        if (cohort.end_date) {
          const exp = new Date(new Date(cohort.end_date + "T00:00:00Z").getTime() + 864e5).toISOString();
          const ex = await sb("/rest/v1/entitlements?select=id&user_id=eq." + u.id + "&source=eq.perform-" + c);
          if (!ex.length) await ins("entitlements", { user_id: u.id, kind: "plan", key: "member", status: "active", source: "perform-" + c, expires_at: exp });
          else await patch("entitlements?user_id=eq." + u.id + "&source=eq.perform-" + c, { status: "active", expires_at: exp });
        }
        if (cohort.application_id && role === "learner") await patch("perform_applications?id=eq." + cohort.application_id + "&enrolment_status=eq.not_enrolled", { enrolment_status: "enrolled" });
        return out(200, { ok: true, access: !!cohort.end_date });
      }
      if (P === "perform_member_remove") {
        const c = id(body.cohort_id); if (!c || !/^[0-9a-f-]{36}$/i.test(body.user_id || "")) return out(400, { error: "Invalid request." });
        await del("perform_members?cohort_id=eq." + c + "&user_id=eq." + body.user_id);
        await patch("entitlements?user_id=eq." + body.user_id + "&source=eq.perform-" + c, { status: "canceled" });
        const left = await sb("/rest/v1/perform_members?select=user_id&role=eq.learner&cohort_id=eq." + c);
        if (!left.length) { const co = (await sb("/rest/v1/perform_cohorts?select=application_id&id=eq." + c))[0]; if (co && co.application_id) await patch("perform_applications?id=eq." + co.application_id + "&enrolment_status=eq.enrolled", { enrolment_status: "not_enrolled" }); }
        return out(200, { ok: true });
      }
      if (P === "perform_exercise_save") {
        const f = (k, n) => String(body[k] || "").slice(0, n);
        const arr = (k) => Array.isArray(body[k]) ? body[k].map(x => String(x).slice(0, 300)).slice(0, 12) : [];
        const row = { title: f("title", 200), skill: f("skill", 120), situation: f("situation", 2000), practise: f("practise", 2000), questions: arr("questions"), example: f("example", 3000), roleplay: f("roleplay", 2000), checklist: arr("checklist"), boundaries: f("boundaries", 2000), lessons: arr("lessons"), source: body.source === "ai_draft" ? "ai_draft" : "manual" };
        if (!row.title) return out(400, { error: "A title is required." });
        const e = id(body.id);
        if (e) { row.status = "draft"; row.approved_at = null; await patch("perform_exercises?id=eq." + e, row); return out(200, { ok: true }); }
        const r = await ins("perform_exercises", Object.assign(row, { status: "draft" })); return out(200, { ok: true, exercise: r[0] });
      }
      if (P === "perform_exercise_status") {
        const e = id(body.id); if (!e || !["draft","approved","retired"].includes(body.status)) return out(400, { error: "Invalid request." });
        await patch("perform_exercises?id=eq." + e, { status: body.status, approved_at: body.status === "approved" ? new Date().toISOString() : null });
        return out(200, { ok: true });
      }
      if (P === "perform_assign") {
        const c = id(body.cohort_id), e = id(body.exercise_id), w = Number(body.week);
        if (!c || !e || !(w >= 1 && w <= 5)) return out(400, { error: "Invalid request." });
        const ex = (await sb("/rest/v1/perform_exercises?select=status&id=eq." + e))[0];
        if (!ex || ex.status !== "approved") return out(200, { ok: false, error: "Only approved exercises can be assigned." });
        await sb("/rest/v1/perform_assignments?on_conflict=cohort_id,exercise_id,week", { method: "POST", headers: Object.assign(svc(), { Prefer: "resolution=ignore-duplicates,return=minimal" }), body: JSON.stringify({ cohort_id: Number(c), exercise_id: Number(e), week: w }) });
        return out(200, { ok: true });
      }
      if (P === "perform_assign_plan") {
        const c = id(body.cohort_id); if (!c) return out(400, { error: "Invalid request." });
        const ex = await sb("/rest/v1/perform_exercises?select=id&status=eq.approved&order=id&limit=3");
        if (ex.length < 3) return out(200, { ok: false, error: "Approve the three launch exercises first." });
        const rows = []; [1, 2, 3, 4].forEach(w => ex.forEach(x => rows.push({ cohort_id: Number(c), exercise_id: x.id, week: w })));
        await sb("/rest/v1/perform_assignments?on_conflict=cohort_id,exercise_id,week", { method: "POST", headers: Object.assign(svc(), { Prefer: "resolution=ignore-duplicates,return=minimal" }), body: JSON.stringify(rows) });
        return out(200, { ok: true, count: rows.length });
      }
      if (P === "perform_unassign") {
        const a = id(body.id); if (!a) return out(400, { error: "Invalid request." });
        await del("perform_assignments?id=eq." + a); return out(200, { ok: true });
      }
      return out(400, { error: "Unknown action." });
    }
    return out(400, { error: "Unknown action." });
  } catch (e) {
    return out(500, { error: "Admin service error. Please try again." });
  }
};
