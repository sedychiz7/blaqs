# BlaqsAI

A minimal AI agent: an LLM in a loop with tools.

## Tools
- `read_file` / `write_file`: confined to the `workspace/` folder
- `run_command`: shell command in `workspace/`, **asks for your approval every time**

## Run (Termux or any machine with Python 3.10+)
```bash
cd BlaqsAI
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key-here
python agent.py
```

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
