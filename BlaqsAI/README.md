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

## Source review workflow
To review one of your own apps (SchoolRun, FIF Finder, etc.) rather than scan a
running target:
1. `git clone <repo> workspace/<name>` via `run_command`.
2. `list_dir` / `search_code` to map structure and spot patterns worth a closer
   look (auth checks, hardcoded secrets, string-built SQL, unsanitized input).
3. `read_file` on what those point at.
4. `add_finding` for anything real, with file:line evidence.
5. `list_findings` before a repeat pass, so old findings aren't re-logged and you
   can check whether they still reproduce.
6. `generate_report` for a project when you want a writeup — one markdown file,
   severity-grouped, in `workspace/reports/`.

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

## Using your Kali machine
`run_kali_command` reaches Kali over plain `ssh` — it stores no password or key itself,
it just reuses whatever SSH access you already have set up.

1. Make sure you can already run `ssh kali-user@kali-ip` from wherever BlaqsAI runs,
   ideally with a key (`ssh-copy-id kali-user@kali-ip`) so it doesn't need `BatchMode`
   to fall back to a password prompt it can't answer.
2. Set the host before starting the agent:
   ```bash
   export BLAQS_KALI_HOST=kali-user@kali-ip
   # export BLAQS_KALI_PORT=22   # only if not the default
   ```
3. Tell the agent which target(s) you're authorized to test (e.g. your own lab,
   or a specific Hack The Box machine) — the system prompt reminds it to stick to
   targets you've actually named.

Leave `BLAQS_KALI_HOST` unset to disable the tool entirely.

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

## Safety
- Step limit (`BLAQS_MAX_STEPS`, default 50) stops runaway loops but gives a real test pass room to enumerate, try things, and adjust
- File access can't escape `workspace/`
- Commands need a `y` from you — every time, no "approve all" — and are scope-checked before you're even asked

## Next ideas
- Dependency/secret scanner integration (npm audit, pip-audit, gitleaks) as first-class tools instead of ad-hoc shell calls
- Authenticated-testing scaffolding (stored test credentials, multi-account/IDOR checks)
- Multi-target/concurrency support and more resilient error handling
- A real report deliverable: PDF export, executive summary, CVSS-style scoring
- Background jobs for long scans, with polling instead of a blocking timeout
- Telegram or WhatsApp front end
