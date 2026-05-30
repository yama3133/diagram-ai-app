import {
  invokeClaude,
  extractYaml,
  type BedrockImageMediaType,
} from "@/lib/bedrock";
import { SYSTEM_PROMPT, FEW_SHOT_EXAMPLES } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_MEDIA_TYPES: BedrockImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

type Body = {
  prompt?: string;
  imageBase64?: string;
  imageMediaType?: BedrockImageMediaType;
};

export async function POST(request: Request) {
  try {
    const { prompt, imageBase64, imageMediaType } =
      (await request.json()) as Body;

    const hasPrompt = typeof prompt === "string" && prompt.trim().length > 0;
    const hasImage =
      typeof imageBase64 === "string" && imageBase64.length > 0;
    if (!hasPrompt && !hasImage) {
      return Response.json(
        { error: "prompt or imageBase64 is required" },
        { status: 400 },
      );
    }
    if (hasImage && !ALLOWED_MEDIA_TYPES.includes(imageMediaType!)) {
      return Response.json(
        { error: `imageMediaType must be one of ${ALLOWED_MEDIA_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    // Compose user content: image first (helps Claude ground answer), then text
    const content: Parameters<typeof invokeClaude>[0]["messages"][number]["content"] =
      [];
    if (hasImage) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imageMediaType!,
          data: imageBase64!,
        },
      });
    }
    // Always include some text so Claude knows what to do
    const textInstruction = hasPrompt
      ? prompt!
      : "添付した構成図を読み取り、同等のアーキテクチャを表す YAML を生成してください。";
    content.push({ type: "text", text: textInstruction });

    const raw = await invokeClaude({
      system: SYSTEM_PROMPT + "\n\n" + FEW_SHOT_EXAMPLES,
      messages: [{ role: "user", content }],
      maxTokens: 4096,
    });

    const yaml = extractYaml(raw);
    return Response.json({ yaml });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
