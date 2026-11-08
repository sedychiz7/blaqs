# BlaqsAI

A minimal AI agent: an LLM in a loop with tools.

## Tools
- `read_file` / `write_file`: confined to the `workspace/` folder
- `web_search` / `fetch_url`: DuckDuckGo search (no API key) and page text fetch. Results are treated as untrusted data.
- `remember` / `forget`: long-term memory saved to `memory.json` and loaded into the system prompt every step. It lives outside `workspace/` and is gitignored. Edit or delete the file any time to reset.
- `run_command`: shell command in `workspace/`, **asks for your approval every time**. There's no per-utility tool for nmap, sqlmap, etc. — `run_command` is a shell, so anything already installed on the machine BlaqsAI runs on is reachable through it.

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

## Safety
- Step limit (`MAX_STEPS = 15`) stops runaway loops
- File access can't escape `workspace/`
- Commands need a `y` from you — every time, no "approve all"
- You decide scope: the agent won't infer a target is fair game on its own, but it has no built-in allowlist either, so stay deliberate about what you approve

## Next ideas
- A scope file (`scope.txt`) the agent checks before running anything against an IP/domain
- Logging every step (and every approved command) to a file
- Background jobs for long scans, with polling instead of a blocking timeout
- Telegram or WhatsApp front end
