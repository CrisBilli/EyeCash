# AI in EyeCash: optional, minimal, local if you want

EyeCash works fully without any AI. When you enable one, it is used only to **save you typing**: turning a sentence into an expense, recognising a new bank format, suggesting categories, translating a question into a calculation. It is never given your balances, accounts or history.

## Choosing a provider

The quickest way is the guided script:

```bash
bash setup-ai.sh
```

It writes `.env`, restarts the app and checks the AI is reachable. You can also edit `.env` by hand (see `.env.example`).

| `AI_PROVIDER` | Where requests go | Key | Typical settings |
|---|---|---|---|
| *(unset)* | nowhere: AI off | | |
| `ollama` | **Ollama on your network** | none | `OLLAMA_URL=http://ollama:11434`, `AI_MODEL=qwen2.5:7b` |
| `local` | **any local OpenAI-compatible server** (LM Studio, llama.cpp `server`, vLLM, LocalAI…) | none | `OPENAI_BASE_URL=http://host.docker.internal:1234/v1`, `AI_MODEL=<name>` |
| `anthropic` | Claude API | `ANTHROPIC_API_KEY` | `AI_MODEL=claude-sonnet-5-5`, `AI_MODEL_FAST=claude-haiku-5-5` |
| `openai` | any OpenAI-compatible cloud API (OpenAI, OpenRouter, Mistral, Groq…) | `OPENAI_API_KEY` | `OPENAI_BASE_URL`, `AI_MODEL` |

Other settings:
- `AI_MODEL_FAST`: a smaller model for quick tasks (defaults to `AI_MODEL`).
- `AI_TIMEOUT`: seconds to wait for a reply (300 by default, 600 for local models).
- `AI_WEB_SEARCH=true` (Anthropic only): lets the car/home value estimate look at real listings on the web.

## Running a local model

### Option A: Ollama started by Docker Compose

```bash
bash setup-ai.sh        # choose 1, accept the suggested model
```

or by hand:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen2.5:7b
# .env
AI_PROVIDER=ollama
OLLAMA_URL=http://ollama:11434
AI_MODEL=qwen2.5:7b
docker compose up -d
```

Models are stored in `./ollama/` (ignored by git).

### Option B: Ollama or LM Studio already on the host or on another PC

- **Ollama on the same server:** `AI_PROVIDER=ollama`, `OLLAMA_URL=http://host.docker.internal:11434`
- **Ollama on another machine** of your network: `OLLAMA_URL=http://192.168.x.x:11434`. Start Ollama with `OLLAMA_HOST=0.0.0.0` so it accepts connections from the network.
- **LM Studio** (enable its local server): `AI_PROVIDER=local`, `OPENAI_BASE_URL=http://<host>:1234/v1`, `AI_MODEL=<model id shown by LM Studio>`

### Which model?

EyeCash asks for short, structured JSON answers in Italian. Small instruction-tuned models handle this well:

| Model (Ollama name) | RAM needed (approx.) | Notes |
|---|---|---|
| `qwen2.5:7b` | ~6 GB | Default. Good at JSON and Italian |
| `llama3.1:8b` | ~6 GB | Good general alternative |
| `mistral-nemo` | ~9 GB | Strong in European languages |
| `qwen2.5:3b` | ~3 GB | For small machines; less reliable on new bank formats |

With Ollama, EyeCash asks the model server to return valid JSON (`response_format`), which makes small models much more reliable. For the advisor a 7–8B model is recommended; 3–4B models extract the events well but choose weaker rules (the device then applies its default checks). Models of 1–2B are not enough.

On a CPU-only mini PC, expect a few seconds to a minute per request. That is fine for these tasks, which is why the timeout is longer for local providers. Reading **PDF** statements requires Anthropic; with local models, export CSV or Excel from your bank instead.

## What each feature sends

Every feature has its own switch in **Settings → Privacy**, and every request is listed in the log underneath, so you can see exactly what left the server. Before sending, IBANs, card numbers and long digit sequences are masked.

| Feature | Sent | Never sent |
|---|---|---|
| Quick entry ("23 € pizzeria ieri") | the sentence you type or dictate | anything else |
| Ask your data | the question, category names, account *types* (`conto_1 (Conto)`) | amounts, merchants, account names, results: the device computes them |
| Advisor: opinions such as "is it a good idea…?" (same switch as Ask your data) | the question (and, for a follow-up, the previous question and its recipe); the AI returns future events and rules written with named variables | every number about you: the device computes the variables, runs the month-by-month simulation and writes the answer |
| Can I afford it? (same switch as Ask your data) | only the sentence, e.g. *"a €250,000 house with €50,000 down over 25 years"*; the AI returns price, down payment, rate and term | income, spending, balances, loans, the verdict: the device computes them |
| Categorisation | description and amount of newly imported rows without a category | balances, other transactions |
| New bank format | column headers and up to 12 rows, **digits of amounts masked**; once per bank, then the format is remembered | the rest of the file |
| Asset value estimate | car model/year/km, or town/area/m² of a home (never the address) | anything financial |
| PDF statements (off by default, Anthropic only) | the PDF | |

With `ollama` or `local`, all of the above stays on your network.

## Adding a provider

All calls go through one function, `callAI()` in [`server/ai.js`](../server/ai.js), and configuration lives in [`server/config.js`](../server/config.js). A new provider usually needs only a branch there. Please add a test like [`tests/local-ai.test.js`](../tests/local-ai.test.js) with a fake server.
