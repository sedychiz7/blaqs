# BlaqsAI

A minimal AI agent: an LLM in a loop with tools.

## Tools
- `read_file` / `write_file`: confined to the `workspace/` folder
- `web_search` / `fetch_url`: DuckDuckGo search (no API key) and page text fetch. Results are treated as untrusted data.
- `remember` / `forget`: long-term memory saved to `memory.json` and loaded into the system prompt every step. It lives outside `workspace/` and is gitignored. Edit or delete the file any time to reset.
- `run_command`: shell command in `workspace/`, **asks for your approval every time**
- `run_kali_command`: runs a command on your Kali machine over SSH (for tools installed there), **asks for your approval every time**. Disabled unless `BLAQS_KALI_HOST` is set.

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

## Safety
- Step limit (`MAX_STEPS = 15`) stops runaway loops
- File access can't escape `workspace/`
- Commands need a `y` from you; for anything risky, run in a sandbox/VM, not your main VPS

## Next ideas
- Web search / HTTP tool
- Persistent memory (JSON file or SQLite)
- Logging every step to a file
- Telegram or WhatsApp front end
- Recon tools (nmap, subdomain enum) for authorized targets only, e.g. Hack The Box labs
