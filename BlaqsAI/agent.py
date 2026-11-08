"""BlaqsAI - a minimal AI agent: an LLM in a loop with tools."""

import os
import subprocess
from pathlib import Path

import anthropic

MODEL = os.environ.get("BLAQS_MODEL", "claude-sonnet-5-5")
MAX_STEPS = 15          # hard stop so the loop can never run away
WORKDIR = Path(os.environ.get("BLAQS_WORKDIR", "./workspace")).resolve()
WORKDIR.mkdir(parents=True, exist_ok=True)

SYSTEM_PROMPT = (
    "You are BlaqsAI, a helpful agent. Use the tools when you need to read "
    "files or run commands. Work inside the workspace directory. "
    "Be concise, and stop when the task is done."
)

TOOLS = [
    {
        "name": "read_file",
        "description": "Read a text file from the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Relative path"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Write a text file in the workspace (overwrites).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "run_command",
        "description": "Run a shell command in the workspace. The user must approve it first.",
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
]


def safe_path(rel: str) -> Path:
    """Resolve a path and refuse anything outside the workspace."""
    p = (WORKDIR / rel).resolve()
    if WORKDIR not in p.parents and p != WORKDIR:
        raise ValueError("path escapes the workspace")
    return p


def run_tool(name: str, args: dict) -> str:
    try:
        if name == "read_file":
            return safe_path(args["path"]).read_text()[:20000]
        if name == "write_file":
            p = safe_path(args["path"])
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(args["content"])
            return f"wrote {len(args['content'])} chars to {args['path']}"
        if name == "run_command":
            cmd = args["command"]
            if input(f"\n[approve command?] {cmd}\n(y/N): ").strip().lower() != "y":
                return "command denied by user"
            r = subprocess.run(
                cmd, shell=True, cwd=WORKDIR, capture_output=True, text=True, timeout=60
            )
            return (r.stdout + r.stderr)[:20000] or "(no output)"
        return f"unknown tool: {name}"
    except Exception as e:  # return errors to the model so it can recover
        return f"error: {e}"


def run_agent(task: str, history: list | None = None) -> list:
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    messages = history or []
    messages.append({"role": "user", "content": task})

    for _ in range(MAX_STEPS):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": resp.content})

        for block in resp.content:
            if block.type == "text" and block.text.strip():
                print(f"\nBlaqsAI: {block.text}")

        if resp.stop_reason != "tool_use":
            return messages

        results = []
        for block in resp.content:
            if block.type == "tool_use":
                print(f"  -> {block.name}({block.input})")
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": run_tool(block.name, block.input),
                    }
                )
        messages.append({"role": "user", "content": results})

    print("\n[stopped: reached MAX_STEPS]")
    return messages


if __name__ == "__main__":
    print("BlaqsAI ready. Type a task, or 'exit' to quit.")
    history: list = []
    while True:
        task = input("\nYou: ").strip()
        if task.lower() in {"exit", "quit"}:
            break
        if task:
            history = run_agent(task, history)
