"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type InputImage = {
  data: string; // base64 without the data: prefix
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  previewUrl: string; // full data URL for <img>
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const SAMPLE_PROMPTS = [
  "ALB の後ろに EC2 が 2 台あり、ユーザーがアクセスする構成",
  "VPC 内に Public/Private Subnet。Private に RDS、Public に EC2",
  "S3 の更新で Lambda が動き、結果を DynamoDB に保存",
  "GitHub → Vercel → AWS Lambda の CI/CD",
  "Cloudflare の後ろに ALB と EC2、ユーザーからのトラフィックを処理",
  "Netlify でフロント、Supabase 風に外部 DB、認証は別サービス",
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [yaml, setYaml] = useState("");
  const [imageBase64, setImageBase64] = useState(""); // rendered PNG output
  const [inputImage, setInputImage] = useState<InputImage | null>(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(`対応していない画像形式です: ${file.type || "不明"}（JPEG/PNG/GIF/WebP のみ）`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("画像が大きすぎます（5MB まで）");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // data:<type>;base64,xxxx
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      setError("");
      setInputImage({
        data,
        mediaType: file.type as InputImage["mediaType"],
        previewUrl: result,
      });
    };
    reader.onerror = () => setError("画像の読み込みに失敗しました");
    reader.readAsDataURL(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/"),
    );
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        readFile(file);
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  function clearImage() {
    setInputImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canGenerate = prompt.trim().length > 0 || inputImage !== null;

  async function handleGenerate() {
    if (!canGenerate) return;
    setError("");
    setGenerating(true);
    setImageBase64("");
    try {
      const body: Record<string, string> = {};
      if (prompt.trim()) body.prompt = prompt;
      if (inputImage) {
        body.imageBase64 = inputImage.data;
        body.imageMediaType = inputImage.mediaType;
      }
      const res = await fetch("/api/generate-yaml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate YAML");
      setYaml(data.yaml);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleRender() {
    if (!yaml.trim()) return;
    setError("");
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to render");
      setImageBase64(data.imageBase64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold">Diagram AI — 自然言語・画像で AWS 構成図</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Bedrock Claude Haiku 4.5 + diagram-as-code (awslabs)
        </p>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
        <section className="flex flex-col gap-3">
          <label className="text-sm font-medium">
            1. 構成を記述（テキスト / 画像）
          </label>
          <textarea
            className="w-full h-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例: ALB の後ろに EC2 が 2 台、RDS にもつながる（構成図の画像を貼り付け / ドロップも可）"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={handlePaste}
          />

          {/* Image input zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-3"
          >
            {inputImage ? (
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={inputImage.previewUrl}
                  alt="入力構成図"
                  className="max-h-32 rounded border border-zinc-200 dark:border-zinc-700 object-contain"
                />
                <div className="flex flex-col gap-2 text-xs text-zinc-500">
                  <span>この構成図を元に YAML を生成します</span>
                  <button
                    type="button"
                    onClick={clearImage}
                    className="self-start px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    画像を削除
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">
                  既存の構成図を読み込む：貼り付け（⌘V）・ドロップ・ファイル選択
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-3 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  画像を選択
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrompt(p)}
                className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {p.slice(0, 24)}…
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !canGenerate}
            className="self-start px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? "生成中…" : "YAML を生成"}
          </button>

          <label className="text-sm font-medium mt-4">
            2. YAML を確認・編集
          </label>
          <div className="h-96 border border-zinc-300 dark:border-zinc-700 rounded overflow-hidden">
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={yaml}
              onChange={(v) => setYaml(v ?? "")}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleRender}
            disabled={rendering || !yaml.trim()}
            className="self-start px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rendering ? "描画中…" : "図を描画"}
          </button>
        </section>

        <section className="flex flex-col gap-3">
          <label className="text-sm font-medium">3. プレビュー</label>
          <div className="flex-1 min-h-96 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center p-4">
            {imageBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${imageBase64}`}
                alt="Generated diagram"
                className="max-w-full max-h-[600px] object-contain"
              />
            ) : (
              <p className="text-sm text-zinc-500 text-center">
                YAML を生成して「図を描画」を押すと
                <br />
                ここにアーキテクチャ図が表示されます
              </p>
            )}
          </div>
          {imageBase64 && (
            <a
              href={`data:image/png;base64,${imageBase64}`}
              download="diagram.png"
              className="self-start px-4 py-2 rounded border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              PNG をダウンロード
            </a>
          )}
          {error && (
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
