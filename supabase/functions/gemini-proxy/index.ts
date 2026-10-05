// Brewlog — Gemini proxy.
//
// Holds the Gemini API key server-side so signed-in users can render and
// read labels without the key ever reaching a browser. Deploy this as an
// Edge Function named `gemini-proxy` and set the GEMINI_API_KEY secret.
//
// Access: signed-in members whose profile is approved (or admins).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Only real signed-in users — the anon key alone is refused.
  const auth = req.headers.get("Authorization") ?? "";
  const userRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      Authorization: auth,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
  });
  if (!userRes.ok) {
    return json(401, { error: { message: "Sign in to use AI features" } });
  }
  const user = await userRes.json();
  if (!user?.id) {
    return json(401, { error: { message: "Sign in to use AI features" } });
  }

  // Signing up is open, so an account alone is not enough: only members an
  // admin has approved may spend the key. Asked as the caller, so RLS lets
  // them see exactly their own profile row.
  const profRes = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/profiles?select=approved,is_admin&user_id=eq.${encodeURIComponent(user.id)}`,
    {
      headers: {
        Authorization: auth,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      },
    },
  );
  const prof = profRes.ok ? (await profRes.json())?.[0] : null;
  if (!prof?.approved && !prof?.is_admin) {
    return json(403, { error: { message: "Your account is waiting for approval" } });
  }

  // Forward one request to the Gemini API, key injected server-side. Only
  // the calls the app actually makes are allowed through — anything else
  // under /v1beta/ (files, cached content, tuned models, …) could read or
  // delete things on the key's project.
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const allowed =
    (req.method === "GET" && /^\/v1beta\/models(\?pageSize=\d{1,4})?$/.test(path)) ||
    (req.method === "POST" &&
      (/^\/v1beta\/models\/[A-Za-z0-9._-]+:generateContent$/.test(path) ||
        path === "/v1beta/interactions"));
  if (!allowed) {
    return json(400, { error: { message: "Bad path" } });
  }

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return json(500, {
      error: { message: "GEMINI_API_KEY secret is not set on the function" },
    });
  }

  const upstream = await fetch(
    "https://generativelanguage.googleapis.com" + path,
    {
      method: req.method,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: req.method === "POST" ? await req.text() : undefined,
    },
  );

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
});
