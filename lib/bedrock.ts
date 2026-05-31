import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

// NOTE: モデル ID は環境に合わせて要確認。多くの場合 cross-region inference profile が必要。
// 例:
//   "us.anthropic.claude-haiku-4-5-20251001-v1:0"  ← us-east-1 / us-west-2 で利用可
//   "anthropic.claude-haiku-4-5-20251001-v1:0"     ← direct（リージョン限定）
export const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ??
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Lazily create the client so that importing this module (e.g. during
// `next build` page-data collection, where AWS env vars are absent) does not
// throw "Region is missing". The client is only constructed at request time.
let _client: BedrockRuntimeClient | null = null;
function getBedrockClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return _client;
}

type BedrockTextBlock = { type: "text"; text: string };
export type BedrockImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";
type BedrockImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: BedrockImageMediaType; data: string };
};
type BedrockContentBlock = BedrockTextBlock | BedrockImageBlock;
type BedrockMessage = { role: "user" | "assistant"; content: BedrockContentBlock[] };

export async function invokeClaude(opts: {
  system: string;
  messages: BedrockMessage[];
  maxTokens?: number;
}): Promise<string> {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: opts.messages,
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const res = await getBedrockClient().send(command);
  const decoded = JSON.parse(new TextDecoder().decode(res.body));
  const text = decoded?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Bedrock response did not contain text content");
  }
  return text;
}

export function extractYaml(raw: string): string {
  const match = raw.match(/```ya?ml\s*\n([\s\S]*?)```/);
  return (match ? match[1] : raw).trim();
}
