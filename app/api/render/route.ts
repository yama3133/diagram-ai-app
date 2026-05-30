export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { yaml } = (await request.json()) as { yaml?: string };
    if (!yaml || typeof yaml !== "string") {
      return Response.json({ error: "yaml is required" }, { status: 400 });
    }

    const lambdaUrl = process.env.RENDER_LAMBDA_URL;
    if (!lambdaUrl) {
      return Response.json(
        { error: "RENDER_LAMBDA_URL is not configured" },
        { status: 500 },
      );
    }

    const lambdaRes = await fetch(lambdaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml }),
    });

    if (!lambdaRes.ok) {
      const text = await lambdaRes.text();
      return Response.json(
        { error: `Lambda error: ${lambdaRes.status} ${text}` },
        { status: 502 },
      );
    }

    const data = (await lambdaRes.json()) as {
      imageBase64?: string;
      error?: string;
    };

    if (data.error) {
      return Response.json({ error: data.error }, { status: 500 });
    }
    if (!data.imageBase64) {
      return Response.json(
        { error: "Lambda did not return imageBase64" },
        { status: 500 },
      );
    }

    return Response.json({ imageBase64: data.imageBase64 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
