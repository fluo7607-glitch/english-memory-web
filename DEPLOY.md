# Deploy (Public URL for Friends)

This project can run as a single web service:
- Web UI: `/`
- API: `/enhance`

## Option A: Render (recommended)

1. Push `/Users/apple/Documents/Playground/english_memory_web` to a GitHub repo.
2. In Render, create **Blueprint** from this repo (it will read `render.yaml`).
3. In Render service env vars, set:
   - `OPENAI_API_KEY` = your provider key (SiliconFlow key, etc.)
4. Deploy.
5. Open your Render URL on phone: `https://<your-app>.onrender.com`

## Option B: Local test

```bash
cd /Users/apple/Documents/Playground/english_memory_web
export LLM_PROVIDER=openai
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.siliconflow.cn/v1"
export OPENAI_MODEL="Qwen/Qwen3.5-27B"
python3 online_proxy.py
```

Then open:
- `http://127.0.0.1:8787/`

## Notes

- Keep API keys only in server environment variables.
- If key was exposed, rotate it immediately.
