// Stripe webhook: verifies the signature, then records what the customer bought.
// Required Netlify environment variables (Site configuration > Environment variables):
//   STRIPE_WEBHOOK_SECRET      whsec_... from the Stripe webhook endpoint
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key (server only, never in the website)
//   STRIPE_WEBHOOK_SECRET_TEST optional: whsec_... from a TEST-mode endpoint, used only to verify test events
const crypto = require("crypto");

const LINKS = {
  "plink_1UPufrRueWFwHmpjwG0YHF2S": ["programme", "foundations"],
  "plink_1UPuiGRueWFwHmpjG5ygheQM": ["programme", "floor"],
  "plink_1UPzH9RueWFwHmpj2iQ547xG": ["programme", "fit"],
  "plink_1UPzJjRueWFwHmpjDHL78PrC": ["programme", "pathway"],
  "plink_1UPzLqRueWFwHmpjQ7rWgNSr": ["programme", "cfs"],
  "plink_1UPzNvRueWFwHmpjtzRiC5mC": ["programme", "manager"],
  "plink_1UPzPuRueWFwHmpjxBMrndEj": ["programme", "master"],
  "plink_1UQ3bxRueWFwHmpjquDe0KUd": ["plan", "member"],
  "plink_1UQ3f7RueWFwHmpjqSySTIs7": ["plan", "member"],
  "plink_1UQ3iDRueWFwHmpjaSrruk6A": ["plan", "enterprise"],
  "plink_1UQ3l6RueWFwHmpjott1vma9": ["plan", "enterprise"]
};

function verify(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")));
  const t = parts.t, v1 = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + payload, "utf8").digest("hex");
  return v1.some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

async function db(method, path, body) {
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error("Supabase " + r.status + " " + (await r.text()));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const sig = event.headers["stripe-signature"];
  const live = verify(raw, sig, process.env.STRIPE_WEBHOOK_SECRET), test = !live && verify(raw, sig, process.env.STRIPE_WEBHOOK_SECRET_TEST);
  if (!live && !test) return { statusCode: 400, body: "Invalid signature" };
  const evt = JSON.parse(raw), obj = evt.data && evt.data.object;
  if (test && evt.livemode) return { statusCode: 400, body: "Live event signed with test secret" };
  try {
    if (evt.type === "checkout.session.completed" && /^perf-\d+$/.test(obj.client_reference_id || "")) {
      // Academy Perform founding pilot: one-time US$200 payment, linked to an application (not a user)
      const PERFORM_LINKS = ["plink_1UXq2NRueWFwHmpjip0ixJis" /* test mode */, "plink_1UYa69RueWFwHmpjtRlLIOuy" /* live */].concat((process.env.PERFORM_PAYMENT_LINKS || "").split(",").map(x => x.trim()).filter(Boolean));
      const ok = obj.mode === "payment" && obj.payment_status === "paid" && (PERFORM_LINKS.includes(obj.payment_link) || (obj.amount_total === 20000 && String(obj.currency).toLowerCase() === "usd"));
      if (!ok) return { statusCode: 200, body: "Ignored: pilot payment did not match" };
      await db("PATCH", "perform_applications?id=eq." + obj.client_reference_id.slice(5) + "&payment_status=neq.paid", { payment_status: evt.livemode ? "paid" : "test_paid", paid_at: new Date().toISOString(), stripe_ref: (evt.livemode ? "" : "test:") + (obj.payment_intent || obj.id) });
      return { statusCode: 200, body: "ok" };
    }
    if (evt.type === "checkout.session.completed") {
      if (!evt.livemode) return { statusCode: 200, body: "Ignored: test event" };
      const map = LINKS[obj.payment_link];
      const uid = obj.client_reference_id;
      if (!map || !uid || !/^[0-9a-f-]{36}$/i.test(uid)) return { statusCode: 200, body: "Ignored: no mapped link or user" };
      await db("POST", "entitlements", { user_id: uid, kind: map[0], key: map[1], status: "active", stripe_ref: obj.subscription || obj.payment_intent || obj.id, source: "stripe" });
    } else if (evt.type === "customer.subscription.deleted") {
      await db("PATCH", "entitlements?stripe_ref=eq." + encodeURIComponent(obj.id), { status: "canceled" });
    }
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};
