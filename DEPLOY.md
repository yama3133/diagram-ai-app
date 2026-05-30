# デプロイ手順

## 全体構成

```
[ユーザー]
    ↓
[Vercel]         ← Next.js（フロント + Bedrock 呼び出し）
    ↓ fetch
[AWS Lambda]     ← Function URL 経由で awsdac CLI を実行（zip パッケージ）
```

本番 URL（参考）：
- フロント: https://diagram-ai-app.vercel.app
- Lambda Function URL: https://gnlniehwnpk5atfdnkejponp6i0kxkid.lambda-url.us-east-1.on.aws/

---

## 1. Lambda（描画部）のデプロイ

zip 形式 + Python 3.12 ランタイム。Docker / Go ビルド不要。

### 前提
- AWS CLI 認証済み（`aws sts get-caller-identity` で確認）
- リージョン: `us-east-1`

### 1-1. awsdac バイナリの取得

```bash
cd /tmp
curl -sL -o awsdac.zip \
  "https://github.com/awslabs/diagram-as-code/releases/download/v0.23/awsdac-v0.23_linux-amd64.zip"
unzip awsdac.zip
cp dist/awsdac-v0.23_linux-amd64/awsdac ~/diagram-ai-app/lambda/awsdac
chmod +x ~/diagram-ai-app/lambda/awsdac
```

### 1-2. zip パッケージ作成

```bash
cd ~/diagram-ai-app/lambda
zip -q function.zip handler.py awsdac
# function.zip ≒ 4.0MB
```

### 1-3. IAM ロール作成

```bash
cat > /tmp/lambda-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name diagram-ai-lambda-exec \
  --assume-role-policy-document file:///tmp/lambda-trust.json

aws iam attach-role-policy \
  --role-name diagram-ai-lambda-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

sleep 10  # IAM 伝播待ち
```

### 1-4. Lambda 関数作成

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws lambda create-function \
  --function-name diagram-ai-render \
  --runtime python3.12 \
  --role arn:aws:iam::$ACCOUNT_ID:role/diagram-ai-lambda-exec \
  --handler handler.handler \
  --zip-file fileb://function.zip \
  --timeout 30 \
  --memory-size 1024 \
  --architectures x86_64 \
  --region us-east-1

aws lambda wait function-active --function-name diagram-ai-render --region us-east-1
```

### 1-5. Function URL 作成

```bash
aws lambda create-function-url-config \
  --function-name diagram-ai-render \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type","authorization"],"MaxAge":3600}' \
  --region us-east-1
# 出力された FunctionUrl をメモる
```

### 1-6. 公開呼び出し許可（**2 つ必要**）

2025年10月以降の Lambda 仕様変更で、Function URL の公開呼び出しには
`lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` の **両方** が必要です。

```bash
# (1) URL 呼び出し許可
aws lambda add-permission \
  --function-name diagram-ai-render \
  --statement-id FunctionURLAllowPublic \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region us-east-1

# (2) 関数実行許可（Function URL 経由のみ）
aws lambda add-permission \
  --function-name diagram-ai-render \
  --statement-id FunctionURLAllowInvoke \
  --action lambda:InvokeFunction \
  --principal "*" \
  --invoked-via-function-url \
  --region us-east-1
```

(2) を忘れると `403 Forbidden / AccessDeniedException` になる。

### 1-7. 動作確認

```bash
URL="https://xxxxx.lambda-url.us-east-1.on.aws/"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"yaml":"Diagram:\n  Resources:\n    Canvas:\n      Type: AWS::Diagram::Canvas\n      Children: [EC2]\n    EC2:\n      Type: AWS::EC2::Instance\n"}' \
  -o /tmp/test.json -w "HTTP %{http_code}\n"
```

### 関数コード更新時

```bash
cd ~/diagram-ai-app/lambda
zip -q function.zip handler.py awsdac
aws lambda update-function-code \
  --function-name diagram-ai-render \
  --zip-file fileb://function.zip \
  --region us-east-1
```

---

## 2. Vercel（フロント + Bedrock）のデプロイ

### 2-1. プロジェクトリンク

```bash
cd ~/diagram-ai-app
vercel link --yes --project diagram-ai-app
```

### 2-2. 環境変数登録

| キー | 値 |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Bedrock 呼び出し権限を持つ IAM ユーザーのキー |
| `AWS_SECRET_ACCESS_KEY` | 同シークレットキー |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `RENDER_LAMBDA_URL` | 1-5 で取得した Function URL |

CLI でまとめて投入する例：

```bash
for env_pair in \
  "AWS_REGION=us-east-1" \
  "AWS_ACCESS_KEY_ID=AKIA..." \
  "AWS_SECRET_ACCESS_KEY=..." \
  "BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0" \
  "RENDER_LAMBDA_URL=https://xxx.lambda-url.us-east-1.on.aws/"; do
  key="${env_pair%%=*}"; val="${env_pair#*=}"
  for envname in production preview development; do
    printf "%s" "$val" | vercel env add "$key" "$envname"
  done
done
```

### 2-3. IAM 最小権限ポリシー（Bedrock 用）

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel"],
    "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*"
  }]
}
```

### 2-4. デプロイ

```bash
vercel --prod --yes
```

---

## 3. ローカル開発

```bash
cp .env.local.example .env.local
# .env.local を編集（Lambda は事前デプロイ済みのものを参照）
npm run dev
# http://localhost:3000
```
