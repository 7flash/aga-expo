// Handles GET requests to /aga
export async function GET(req: Request) {
  const file = Bun.file("aga-url.txt");
  
  // 1. Fail if the file hasn't been created yet
  if (!(await file.exists())) {
    return new Response("Redirect URL not configured.", { status: 404 });
  }

  const targetUrl = (await file.text()).trim();

  // 2. Fail if the file exists but is empty
  if (!targetUrl) {
    return new Response("Redirect URL is empty.", { status: 500 });
  }

  // 3. Execute the redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: targetUrl,
    },
  });
}

// Handles POST requests to /update-aga
export async function POST(req: Request) {
  // 1. Check for your secret authorization token
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== "Bearer aga77") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // 2. Parse the JSON body. 
    // This expects the raw string payload you used previously: '"https://..."'
    const newUrl = await req.json(); 

    // Validate that a string was actually provided
    if (typeof newUrl !== "string" || !newUrl.startsWith("http")) {
      return new Response("Invalid payload. Provide a valid URL string.", { status: 400 });
    }

    // 3. Save the new URL securely to disk using Bun
    await Bun.write("aga-url.txt", newUrl.trim());

    // 4. Return success
    return new Response(JSON.stringify({ success: true, updatedUrl: newUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response("Bad Request: Invalid JSON body format", { status: 400 });
  }
}
