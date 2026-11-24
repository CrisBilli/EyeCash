# EyeCash · advisor benchmark

100 questions to measure how well a model works as the EyeCash advisor, **before** choosing hardware or fine-tuning.

- **Made-up data only.** A fictitious person with two years of finances is generated from a fixed seed. No real data is involved.
- **The same tools as the app's advisor chat.** The model calls them, the benchmark computes them on the made-up data, and the model answers.
- **Expected answers computed by code** from the data, never typed by hand.
- **Automatic first score.** It checks four things: whether the model called the right tools, whether the right figures appear (with a tolerance), the verdict, and the required or forbidden words. Opinion answers still need a human review, so send the `.json` file for analysis.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer, with no packages to install, and a model server compatible with OpenAI's API (Ollama, LM Studio, Strata, llama.cpp, vLLM…). From the repository folder:

```bash
# Ollama on this computer, default model qwen3:8b
node bench/run.js

# another model
node bench/run.js --model qwen3.5:9b

# a model on another computer (e.g. through Tailscale)
node bench/run.js --url http://pc-casa:11434/v1 --model qwen3:8b

# LM Studio / Strata: their OpenAI-compatible address and model name
node bench/run.js --url http://localhost:1234/v1 --model <name>

# a few questions, printing the answers
node bench/run.js --only q001,q072,q092 --verbose
node bench/run.js --cat pareri
```

The results are written to `bench/results/`:
- a `.json` file with every question, the tools called, their results, the answer and the automatic checks;
- a `.md` report with the score per category and the list of failed checks.

## The 100 questions

| Category | Questions | What it measures |
|---|---|---|
| `fatti` | 20 | Reading the right figure (income, spending, cash, net worth…) |
| `confronti` | 15 | Comparing periods and categories, spotting trends |
| `ricerca` | 10 | Finding transactions by merchant, date, amount |
| `ricorrenti` | 8 | Subscriptions and fixed costs, price increases |
| `portafoglio` | 10 | Allocation, rebalancing, gains, costs, taxes; not inventing market data |
| `debiti_obiettivi` | 8 | Loan, savings goals |
| `pareri` | 20 | "Can I afford…?" with cash simulations |
| `consigli` | 5 | Open advice that must rely on the data |
| `fuori_ambito` | 4 | Off-topic, prompt injection, tax questions, sensitive data |

The made-up person has a few situations built in on purpose:
- clothing spending far above average this month;
- a subscription price increase;
- an emergency fund below 6 months;
- a portfolio with too many equities;
- a car loan;
- two savings goals behind schedule.

## Options

| Option | Default | |
|---|---|---|
| `--url` | `http://localhost:11434/v1` | OpenAI-compatible base URL |
| `--model` | `qwen3:8b` | Model name |
| `--key` | | API key, if the server needs one |
| `--temperature` | `0.3` | Same as the app's chat |
| `--max-steps` | `6` | Tool rounds per question, same as the app |
| `--timeout` | `300` | Seconds per model call |
| `--only`, `--cat` | | Run a subset |
| `--out` | `bench/results` | Output folder |
