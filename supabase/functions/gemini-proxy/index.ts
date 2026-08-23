// Brewlog — Gemini proxy.
//
// Holds the Gemini API key server-side so signed-in users can render and
// read labels without the key ever reaching a browser. Deploy this as an
// Edge Function named `gemini-proxy` and set the GEMINI_API_KEY secret.
//
// Access: any signed-in user of this project. Control who that is with
// Authentication -> Sign In / Providers -> "Allow new users to sign up".

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

  // Forward one request to the Gemini API, key injected server-side.
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith("/v1beta/") || path.includes("..")) {
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
