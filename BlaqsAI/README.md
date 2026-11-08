# BlaqsAI

A minimal AI agent: an LLM in a loop with tools.

## Tools
- `read_file` / `write_file`: confined to the `workspace/` folder
- `web_search` / `fetch_url`: DuckDuckGo search (no API key) and page text fetch. Results are treated as untrusted data.
- `download_file`: saves a URL's raw bytes into the workspace — for APKs, binaries, or anything `fetch_url`'s HTML-to-text pass would mangle. Capped at 200MB by default (`BLAQS_MAX_DOWNLOAD_MB`); a partial file is deleted if the cap is hit mid-download.
- `remember` / `forget`: long-term memory saved to `memory.json` and loaded into the system prompt every step. It lives outside `workspace/` and is gitignored. Edit or delete the file any time to reset.
- `run_command`: shell command in `workspace/`, **asks for your approval every time**. There's no per-utility tool for nmap, sqlmap, etc. — `run_command` is a shell, so anything already installed on the machine BlaqsAI runs on is reachable through it.
- `list_dir` / `search_code`: browse and grep source under `workspace/`, for reviewing a cloned app's code rather than reading files blind.
- `add_finding` / `update_finding_status` / `list_findings`: a findings log, saved to `findings.json` outside the workspace. Each finding has a project, title, severity (critical/high/medium/low/info), description, evidence, and status (open/fixed/accepted/false_positive). Open findings are summarized in the system prompt every step, so the agent doesn't re-report what's already tracked.
- `generate_report`: builds a markdown report per project straight from `findings.json`, written to `workspace/reports/`. It's assembled by code, not drafted freely by the model, so it can't state anything that wasn't actually logged as a finding — grouped by severity, with a separate "Resolved" section for fixed/false-positive items.
- `submit_flag` / `list_flags`: for CTF/lab boxes specifically — a one-shot capture, not an ongoing tracked review, so it's a separate log (`ctf_flags.json`) from findings. Rejects a flag already recorded for the same challenge.
- `binary_info`: fast triage on a binary in the workspace — `file`, `checksec` (if installed), and readable `strings` — before deciding whether to disassemble or debug further.
- `add_scope_target` / `remove_scope_target` / `list_scope`: the authorized-testing scope, saved to `scope.json`. **Enforced in code**, not just a prompt instruction — `run_command`, `fetch_url`, and `download_file` are blocked if the command/URL references a host/IP that isn't in scope and scope isn't empty.
- `scan_dependencies`: runs `npm audit` (package.json) or `pip-audit` (requirements.txt) against a workspace path and auto-logs a finding per vulnerable dependency at medium severity or above — severities and descriptions come straight from the scanner's own JSON, not interpreted freely.
- `scan_secrets`: uses `gitleaks` if installed, otherwise a built-in regex fallback (AWS keys, generic API key assignments, private key blocks, Slack tokens, Google API keys, JWTs) over text files. Auto-logs a finding per match with the secret **redacted** (first/last 4 chars only) — the fallback is explicitly flagged as less thorough than gitleaks in each finding's description, so it reads as "verify this" rather than "confirmed."
- `add_credential` / `list_credentials` / `get_credential` / `remove_credential`: stored test-account credentials for authenticated testing (IDOR/permission checks across accounts), saved to `credentials.json`. The secret is **never** echoed in `list_credentials` or written to `audit.log` in plaintext (both are redacted at the point of logging) — only `get_credential`'s direct return carries the real value, for the one call that actually needs it. For your own test accounts only, never a real user's.
- `export_report_pdf`: same source of truth as `generate_report` (`findings.json`, not a re-parse of the markdown) — a PDF with an executive summary, CVSS stats, and the same severity grouping. Requires `fpdf2`.

## Source review workflow
To review one of your own apps (SchoolRun, FIF Finder, etc.) rather than scan a
running target:
1. `git clone <repo> workspace/<name>` via `run_command`.
2. `list_dir` / `search_code` to map structure and spot patterns worth a closer
   look (auth checks, hardcoded secrets, string-built SQL, unsanitized input).
3. `read_file` on what those point at.
4. `add_finding` for anything real, with file:line evidence. Add a `cvss` score
   (0.0-10.0) if you have a real basis for one — optional, severity still drives
   the report either way.
5. `scan_dependencies` and `scan_secrets` early in the pass — they log findings
   straight from the underlying tool's output, more reliable than eyeballing a
   lockfile or grepping for keys by hand.
6. For anything that needs a logged-in user (IDOR, permission checks across
   accounts), `add_credential` your own test accounts first, then `get_credential`
   when a test actually needs the value.
7. `list_findings` before a repeat pass, so old findings aren't re-logged and you
   can check whether they still reproduce.
8. `generate_report` (markdown) or `export_report_pdf` (PDF, for handing to
   someone else or keeping with a release) when you want a writeup.

## Running it on Kali
Install BlaqsAI directly on your Kali box (rather than running it elsewhere and
reaching Kali over the network) and `run_command` gets you every tool already on
that machine for free — no extra wiring needed per tool.

```bash
git clone https://github.com/sedychiz7/blaqs
cd blaqs && git checkout blaqsai-starter && cd BlaqsAI
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key
python agent.py
```

If the agent isn't sure what's installed, it'll check with `which <tool>` or
`apt list --installed` before assuming. Command timeout defaults to 10 minutes
(`BLAQS_COMMAND_TIMEOUT`, in seconds) so longer scans have room to finish.

**Only point it at targets you own or are explicitly authorized to test** — your
own lab, a named Hack The Box machine, etc. The system prompt reminds it of this,
but you're still the one deciding what's in scope.

## Run (Termux or any machine with Python 3.10+)
```bash
cd BlaqsAI
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key-here
python agent.py
```

By default BlaqsAI uses the Anthropic API (`claude-sonnet-5-5`), which costs
money per request. See "LLM provider / running for free" below to swap in a
free or fully local model instead — none of the tools, scope enforcement,
findings pipeline, or audit log change; only the model behind the agent loop
changes.

## LLM provider / running for free
BlaqsAI talks to its model through a small provider layer, selected with the
`BLAQS_PROVIDER` env var. Three options:

### `anthropic` (default) — paid, most reliable tool use
```bash
export BLAQS_PROVIDER=anthropic   # or just leave it unset
export ANTHROPIC_API_KEY=your-key-here
python agent.py
```

### `ollama` — free, fully local, no API key, no internet required
Runs entirely on your own machine via [Ollama](https://ollama.com).
```bash
# one-time setup
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1          # or qwen2.5, mistral-nemo, firefunction-v2 —
                               # pick a model that explicitly supports tool/
                               # function calling; plain chat models will not
                               # reliably emit tool_calls
ollama serve &                 # if not already running as a service

export BLAQS_PROVIDER=ollama
export BLAQS_MODEL=llama3.1    # optional, this is the default for this provider
python agent.py
```
Ollama exposes an OpenAI-compatible endpoint at `http://localhost:11434/v1` by
default — BlaqsAI talks to it with the `openai` SDK and no API key is needed.
Override the endpoint with `BLAQS_BASE_URL` if Ollama is running elsewhere
(e.g. another machine on your LAN).

### `openai` — any OpenAI-compatible endpoint (free-tier cloud options)
For a free-tier hosted alternative instead of local inference — e.g.
[Groq](https://console.groq.com) or [OpenRouter](https://openrouter.ai), both
of which offer free API keys and OpenAI-compatible endpoints:
```bash
export BLAQS_PROVIDER=openai
export BLAQS_BASE_URL=https://api.groq.com/openai/v1   # or openrouter.ai/api/v1, etc.
export BLAQS_API_KEY=your-free-tier-key
export BLAQS_MODEL=llama-3.3-70b-versatile              # pick a tool-calling-capable model offered by that provider
python agent.py
```

**Reality check:** smaller/free/local models are noticeably less reliable at
multi-step tool calling than Claude — expect more malformed tool calls, more
steps wasted re-reading its own state, and occasional loops where it forgets
to call a tool it just said it would use. For anything you're relying on
(a real pentest before a Play Store submission, say), the Anthropic provider
is still the dependable default; treat the free providers as good for
low-stakes exploration, learning the tool surface, or offline/no-internet
use, not as a drop-in replacement for serious engagements.

## Mobile app (APK/IPA) review workflow
Different shape from a web app or source repo — no running server to scan, no
git clone:
1. `download_file` if there's a direct APK link, or `adb pull` / `adb shell pm
   path <package>` via `run_command` for a connected test device.
2. Decompile before reading: `apktool d` for the manifest/resources, `jadx`
   for readable Java/Kotlin. The agent checks with `which` first rather than
   assuming either is installed.
3. `search_code` / `list_dir` on the decompiled output, same as a cloned repo —
   looking for hardcoded secrets, insecure local storage, missing certificate
   pinning, exported components, cleartext traffic allowed.
4. For runtime behavior (what the app actually sends over the network), a
   proxy like mitmproxy or Burp between the test device and the network is
   the real way to see it — this agent doesn't automate that part.
5. `add_finding` / `generate_report` as usual.

## CTF / lab box workflow (HTB, picoCTF, etc.)
Different again from reviewing your own apps — one-shot, not an ongoing tracked
review:
1. Recon/exploit as usual via `run_command` (nmap, metasploit, whatever's installed).
2. For a binary challenge, `download_file` or pull it over, then `binary_info`
   for a fast first look before reaching for a disassembler/debugger.
3. Exploit dev against a binary (crafting a payload, reading an offset back,
   adjusting) is iterative — expect repeated `run_command` calls using whatever
   of pwntools/gdb+gdb-peda or pwndbg/ROPgadget/radare2/Ghidra (headless) is
   installed.
4. `submit_flag` once captured. `list_flags` first if resuming, so a captured
   flag isn't redone.
5. Only against a target explicitly named as in scope — never inferred.

## Scope enforcement and audit log
- **Scope is enforced in code**, not just a system-prompt instruction. Add a
  target with `add_scope_target` once the user has actually said it's
  authorized (`fif-finder-staging.example.com`, an HTB IP, etc.). While
  `scope.json` has entries, `run_command`/`fetch_url`/`download_file` are
  blocked outright if they reference a host/IP not in it — the model never
  gets the chance to run them, let alone ask for approval.
  - An **empty** scope blocks nothing (unconfigured state, not "allow all" —
    but it does mean nothing's been locked down yet, so set scope early).
  - Detection is a regex heuristic (IPv4/CIDR, hostnames) over the command
    text, not a real parser or a network-level control — it catches the
    obvious case, it isn't a sandbox. `localhost`/`127.0.0.1` are always
    allowed.
  - `BLAQS_SCOPE_MODE=warn` allows out-of-scope targets through but still
    reports them (default is `enforce`).
- **Every tool call is audited automatically** to `audit.log` (one JSON line
  per call: timestamp, tool, arguments, result) — no action needed, and no
  way for the model to skip it, since logging happens in `run_tool` around
  every dispatch.

## Resilience
- API calls retry with exponential backoff on rate limits, connection drops,
  and server overload (429/500/502/503/529) — up to 5 attempts. A real error
  with the request itself (bad input, auth failure) raises immediately rather
  than retrying something retrying can't fix.
- The conversation is written to `history.json` after every step, not just at
  the end — a crash mid-pentest-pass doesn't lose what came before it. Resume
  with `BLAQS_RESUME=1 python agent.py`.
- A crash inside one task no longer kills the whole session — the REPL catches
  it, tells you, and lets you keep going (history up to the last completed
  step is already saved).

**What this is not**: true multi-target concurrency (several targets scanned
in parallel). Findings/credentials/scope are namespaced by project, so you can
work multiple targets *in the same session* without their data mixing — but
everything still runs one step at a time. Real parallelism would mean either
file locking or a real database instead of flat JSON files, since concurrent
writers to the same JSON file will corrupt it; that's a bigger change than
this round, not something to fake.

## Safety
- Step limit (`BLAQS_MAX_STEPS`, default 50) stops runaway loops but gives a real test pass room to enumerate, try things, and adjust
- File access can't escape `workspace/`
- Commands need a `y` from you — every time, no "approve all" — and are scope-checked before you're even asked

## Next ideas
- Real multi-target concurrency (would need file locking or a proper database, not flat JSON)
- Background jobs for long scans, with polling instead of a blocking timeout
- Telegram or WhatsApp front end
