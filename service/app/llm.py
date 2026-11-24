"""Run the subscription Claude CLI as a plain text generator: no tools, no MCP servers, empty working dir.

Prompts contain untrusted text (sign-up form, paper abstracts, web pages), so the CLI must not be able to act.
"""
import subprocess
import tempfile

MAX_PROMPT_CHARS = 60_000


def run_claude(prompt: str, model: str = 'sonnet', timeout: int = 180) -> str:
    prompt = prompt[:MAX_PROMPT_CHARS]
    with tempfile.TemporaryDirectory(prefix='deepbridge-llm-') as cwd:
        result = subprocess.run(
            ['claude', '-p', '--model', model, '--tools', '', '--strict-mcp-config'],
            input=prompt, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if result.returncode:
        raise RuntimeError(f'Claude CLI failed (exit {result.returncode})')
    return result.stdout
