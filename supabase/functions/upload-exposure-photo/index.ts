import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Upload an exposure-log photo (base64) to the public `photos` bucket.
// POST {path, base64}. Open to the app's anon callers, so it is fenced in
// (v5, 21 Oct 2026): until then anyone could overwrite any file in `photos`,
// Phil's stop photos included. Now only new files under exposures/, no
// overwrite, at most ~10 MB. Nothing in the app calls it yet
// (exposureImport.ts uploadExposurePhoto has no caller).
const PATH_OK = /^exposures\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?\.(png|jpe?g)$/;
const MAX_BASE64 = 14_000_000;

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  try {
    const { path, base64 } = await req.json();
    if (!path || !base64) return json({ error: "path and base64 required" }, 400);
    if (typeof path !== "string" || !PATH_OK.test(path)) {
      return json({ error: "path must be exposures/<name>.png|jpg" }, 400);
    }
    if (typeof base64 !== "string" || base64.length > MAX_BASE64) return json({ error: "image too large" }, 413);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    // decode base64 -> bytes
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage.from("photos").upload(path, bin, {
      contentType: path.endsWith(".png") ? "image/png" : "image/jpeg",
      upsert: false,
    });
    if (error) return json({ error: error.message }, 500);
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    return json({ ok: true, url: data.publicUrl });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
