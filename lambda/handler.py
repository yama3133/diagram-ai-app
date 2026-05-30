import base64
import json
import os
import shutil
import subprocess
import tempfile

AWSDAC_PATH = "/var/task/awsdac"
# awsdac caches downloaded definition files / icon zips under $HOME/.cache/.
# We pin HOME=/tmp, so this is the path to nuke between invocations to avoid
# stale definition-file content being reused across Lambda warm starts.
AWSDAC_CACHE_DIR = "/tmp/.cache"


def _clear_awsdac_cache() -> None:
    try:
        shutil.rmtree(AWSDAC_CACHE_DIR, ignore_errors=True)
    except Exception:
        pass


def _resp(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(payload),
    }


def handler(event, context):
    if not os.path.exists(AWSDAC_PATH):
        return _resp(500, {"error": f"awsdac binary missing at {AWSDAC_PATH}"})

    # Always clear awsdac's on-disk cache so that updates to the served
    # definition files (e.g. external-icons.yaml on Vercel) are reflected
    # immediately on every invocation, not just on container cold starts.
    _clear_awsdac_cache()

    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError as e:
        return _resp(400, {"error": f"invalid JSON: {e}"})

    yaml_str = body.get("yaml")
    if not yaml_str or not isinstance(yaml_str, str):
        return _resp(400, {"error": "yaml is required"})

    with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
        in_path = os.path.join(tmp, "input.yaml")
        out_path = os.path.join(tmp, "out.png")
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(yaml_str)

        env = {**os.environ, "HOME": "/tmp"}
        try:
            proc = subprocess.run(
                [AWSDAC_PATH, "--allow-untrusted-definitions", in_path, "-o", out_path],
                capture_output=True,
                text=True,
                env=env,
                timeout=25,
                cwd=tmp,
            )
        except subprocess.TimeoutExpired:
            return _resp(504, {"error": "awsdac timed out"})

        if proc.returncode != 0:
            return _resp(500, {
                "error": f"awsdac failed (exit {proc.returncode})",
                "stderr": proc.stderr[-2000:],
                "stdout": proc.stdout[-2000:],
            })

        if not os.path.exists(out_path):
            return _resp(500, {
                "error": "output PNG not generated",
                "stderr": proc.stderr[-2000:],
                "stdout": proc.stdout[-2000:],
            })

        with open(out_path, "rb") as f:
            png = f.read()

        return _resp(200, {
            "imageBase64": base64.b64encode(png).decode("ascii"),
        })
