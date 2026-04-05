import json
import mimetypes
import os
import socket
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib import error, request


def get_provider_config() -> dict:
    provider = os.environ.get("LLM_PROVIDER", "").strip().lower()

    # 默认自动判断：若设置了 QWEN_API_KEY，则走 qwen；否则走 openai
    if not provider:
        provider = "qwen" if os.environ.get("QWEN_API_KEY") else "openai"

    if provider == "qwen":
        return {
            "provider": "qwen",
            "api_key": os.environ.get("QWEN_API_KEY", "").strip() or os.environ.get("OPENAI_API_KEY", "").strip(),
            "model": os.environ.get("QWEN_MODEL", "qwen-plus").strip(),
            # 阿里云百炼 OpenAI 兼容接口
            "base_url": os.environ.get("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip(),
        }

    return {
        "provider": "openai",
        "api_key": os.environ.get("OPENAI_API_KEY", "").strip(),
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip(),
        "base_url": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip(),
    }


def call_openai(word: str, syllable: str, affix: str, meaning: str) -> dict:
    cfg = get_provider_config()
    if not cfg["api_key"]:
        if cfg["provider"] == "qwen":
            raise RuntimeError("未设置 QWEN_API_KEY（或 OPENAI_API_KEY）")
        raise RuntimeError("未设置 OPENAI_API_KEY")
    try:
        cfg["api_key"].encode("latin-1")
    except UnicodeEncodeError:
        raise RuntimeError("API Key 包含非 ASCII 字符（可能仍是“你的SiliconFlowKey”这类占位文本）")

    prompt = f"""
你是英语单词记忆教练。请为单词 {word} 生成适合中国中学生的谐音记忆内容。

要求：
1) 输出必须是 JSON，对象结构：
{{
  "natural": ["..."],
  "cute": ["..."],
  "funny": ["..."],
  "recommendedHomo": "...",
  "recommendedSentence": "...",
  "fullText": "..."
}}
2) 内容自然、可记忆，不要生硬音译。
3) fullText 要包含：发音节奏建议、三风格谐音、至少3条小故事（自然/搞笑/逻辑）、可直接复制内容。
4) 语言用中文。
5) 不要输出 JSON 以外的内容。

已知信息：
- word: {word}
- syllable: {syllable}
- affix: {affix}
- meaning: {meaning}
""".strip()

    body = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": "你输出严格 JSON，不要 Markdown。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "stream": False,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
    }

    timeout_s = int(os.environ.get("ENHANCE_TIMEOUT", "180"))
    retries = int(os.environ.get("ENHANCE_RETRIES", "1"))
    raw = post_with_retry(
        url=f"{cfg['base_url']}/chat/completions",
        api_key=cfg["api_key"],
        body=body,
        timeout_s=timeout_s,
        retries=retries,
    )

    text = extract_model_text(raw).strip()
    if not text:
        return fallback_suggestions(word, syllable, affix, meaning, "上游返回内容为空，已自动降级")

    try:
        data = parse_json_loose(text)
    except Exception as e:
        return fallback_suggestions(word, syllable, affix, meaning, f"模型输出非JSON，已降级：{e}")

    return {
        "natural": data.get("natural") or [],
        "cute": data.get("cute") or [],
        "funny": data.get("funny") or [],
        "recommendedHomo": data.get("recommendedHomo") or "",
        "recommendedSentence": data.get("recommendedSentence") or "",
        "fullText": data.get("fullText") or "",
    }


def extract_model_text(raw: dict) -> str:
    try:
        choices = raw.get("choices") or []
        if not choices:
            return ""
        first = choices[0] or {}

        # 常见 OpenAI 兼容结构
        message = first.get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            # 兼容部分多模态/分片结构
            chunks = []
            for item in content:
                if isinstance(item, dict):
                    if "text" in item:
                        chunks.append(str(item.get("text", "")))
                    elif item.get("type") == "text":
                        chunks.append(str(item.get("text", "")))
                elif isinstance(item, str):
                    chunks.append(item)
            text = "".join(chunks).strip()
            if text:
                return text
        elif isinstance(content, str) and content.strip():
            return content

        # 兼容旧/变体字段
        if isinstance(first.get("text"), str) and first.get("text").strip():
            return first.get("text")
        if isinstance(message.get("reasoning_content"), str) and message.get("reasoning_content").strip():
            return message.get("reasoning_content")
    except Exception:
        return ""
    return ""


def parse_json_loose(text: str) -> dict:
    s = text.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:].strip()
    # 尝试直接解析
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    # 从文本里抽第一段 JSON 对象
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = s[start : end + 1]
        data = json.loads(candidate)
        if isinstance(data, dict):
            return data

    raise ValueError(f"模型未返回可解析 JSON，原文前200字符：{s[:200]}")


def fallback_suggestions(word: str, syllable: str, affix: str, meaning: str, reason: str) -> dict:
    readable = syllable.split("（")[0].replace("·", "")
    return {
        "natural": [f"自然贴合：{readable}"],
        "cute": [f"可爱风：小{readable}"],
        "funny": [f"搞笑梗：{readable}，今天必须拿下"],
        "recommendedHomo": f"{readable}（先重读前半，再连读后半）",
        "recommendedSentence": f"今天背 {word}，先读“{readable}”，再结合场景复述三遍，就能记住。",
        "fullText": (
            f"⚠ 联网模型返回异常，已自动降级为可用结果。\n"
            f"原因：{reason}\n\n"
            f"单词：{word}\n音节：{syllable}\n词缀：{affix}\n释义：{meaning or '（未提供）'}\n\n"
            f"推荐直接复制：\n"
            f"谐音/有趣方式：{readable}（先重读前半，再连读后半）\n"
            f"可爱小句子：今天背 {word}，先读“{readable}”，再结合场景复述三遍，就能记住。"
        ),
    }


def post_with_retry(url: str, api_key: str, body: dict, timeout_s: int, retries: int) -> dict:
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )
            with request.urlopen(req, timeout=timeout_s) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")
            except Exception:
                detail = str(e)
            # 4xx 直接抛出，重试无意义
            if 400 <= e.code < 500:
                raise RuntimeError(f"上游接口错误 {e.code}: {detail[:400]}")
            last_err = RuntimeError(f"上游接口错误 {e.code}: {detail[:400]}")
        except socket.timeout:
            last_err = RuntimeError(f"上游超时（>{timeout_s}s）")
        except Exception as e:
            last_err = e

        if attempt < retries:
            time.sleep(1.2 * (attempt + 1))

    raise last_err or RuntimeError("上游请求失败")


class Handler(BaseHTTPRequestHandler):
    base_dir = os.path.dirname(os.path.abspath(__file__))

    def _write_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._write_json(200, {"ok": True})
            return
        if self.path in ["/", "/index.html"]:
            return self._serve_file("index.html")
        if self.path.startswith("/enhance"):
            self._write_json(405, {"error": "Use POST /enhance"})
            return

        rel = self.path.lstrip("/")
        if not rel:
            rel = "index.html"
        # block path traversal
        if ".." in rel or rel.startswith("/"):
            self._write_json(400, {"error": "invalid path"})
            return
        return self._serve_file(rel)

    def _serve_file(self, rel_path: str):
        file_path = os.path.join(self.base_dir, rel_path)
        if not os.path.isfile(file_path):
            self._write_json(404, {"error": "Not found"})
            return
        ctype, _ = mimetypes.guess_type(file_path)
        ctype = ctype or "application/octet-stream"
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/enhance":
            self._write_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            word = str(payload.get("word", "")).strip().lower()
            syllable = str(payload.get("syllable", "")).strip()
            affix = str(payload.get("affix", "")).strip()
            meaning = str(payload.get("meaning", "")).strip()
            if not word:
                self._write_json(400, {"error": "word 不能为空"})
                return

            suggestions = call_openai(word, syllable, affix, meaning)
            self._write_json(200, {"suggestions": suggestions})
        except Exception as e:
            traceback.print_exc()
            # 兜底降级，避免前端直接失败
            suggestions = fallback_suggestions(
                word=word if "word" in locals() else "unknown",
                syllable=syllable if "syllable" in locals() else "",
                affix=affix if "affix" in locals() else "",
                meaning=meaning if "meaning" in locals() else "",
                reason=str(e),
            )
            self._write_json(200, {"suggestions": suggestions, "fallback": True, "error": str(e)})


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", os.environ.get("ENHANCE_PORT", "8787")))
    server = HTTPServer((host, port), Handler)
    print(f"server running at http://{host}:{port} (api: /enhance)")
    server.serve_forever()


if __name__ == "__main__":
    main()
