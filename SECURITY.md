# Security

## Where keys live

The deployer private key, operator private key, and any RPC keys live ONLY in `~/.zshenv` on the operator's machine. Zsh auto-sources `~/.zshenv` for every shell invocation (including non-interactive), so values land in process env at runtime. Reading the source file is never necessary and risks pasting the value into a conversation context.

## Hard rules (apply with no exceptions)

1. **Never read `~/.zshenv`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.netrc`, `~/.npmrc`, `~/.git-credentials`, or any SSH key.** Not with `cat`, `head`, `tail`, `grep -v`, `Read`, or any other tool. PreToolUse hook blocks these; if the hook is silent, treat it as misconfiguration, not invitation.
2. **Never print key values.** `echo $DEPLOYER_PRIVATE_KEY`, `print(os.getenv("KEY"))`, `vm.toString(privateKey)`, `console.log(process.env.KEY)` are all banned.
3. **Never commit `.env*`, `*.key`, `*.pem`, `keystore/`, `secrets/`.** Covered by `.gitignore`; verify `git diff --cached` before every save point.
4. **Never use `git add -A` for a first save point in a new project.** Add by explicit file name until you've checked the diff manually.
5. **Foundry deploys MUST use `vm.envUint("DEPLOYER_PRIVATE_KEY")`** — reads process env at runtime. Never hardcode. Never `--private-key 0x...` on the CLI either (it shows in shell history).
6. **Python agents MUST use `os.getenv("OPERATOR_PRIVATE_KEY")`** — same pattern. Never `dotenv.load_dotenv("~/.zshenv")`. Never `subprocess.check_output(["bash","-c","echo $KEY"])`.
7. **To CHECK whether a var is set without seeing it:** `[ -n "$VARNAME" ] && echo "set" || echo "not set"` or `echo "${#VARNAME}"` (returns length, not value). Length leaks bits — use the boolean check by default.
8. **If a key string ever appears in tool output or commit content, STOP immediately and ROTATE.** Don't continue the session "carefully" — rotate the source key, generate a fresh one, file an incident note in `ai/incidents/YYYY-MM-DD-leak.md`.

## On-chain blast-radius caps (operator wallet)

Every project that uses an operator key for autonomous on-chain action MUST set a policy struct that caps the damage:

| Param | Testnet default | Mainnet default |
|---|---|---|
| `maxSingleMove` | 500 USDC | 50,000 USDC |
| `dailyCap` | 10,000 USDC | 250,000 USDC |
| Operator multisig | single-sig | 2/3 multisig via Wallets SDK |

Enforce the policy at the executor entrypoint, not in client code.

## Verification before any save point

Run these checks before `git commit`. If any fails, abort.

```bash
# 1. No private-key-shaped strings in staged content
git diff --cached | grep -E '(0x[a-f0-9]{64}|PRIVATE_KEY *= *0x|secret *= *")' && echo "ABORT: key in staged diff"

# 2. No env files staged
git diff --cached --name-only | grep -E '(^\.env|/\.env|\.envrc$|\.key$|\.pem$)' && echo "ABORT: env file staged"

# 3. No literal-32-byte hex in source
grep -rE "0x[0-9a-fA-F]{64}" --include="*.sol" --include="*.py" --include="*.ts" --include="*.js" --include="*.json" . | grep -v 'test/' | grep -v 'mocks/' && echo "REVIEW: long hex string in source"
```

## What to do if a key leaks

1. Stop. No more tool calls that touch keys.
2. Rotate the source key (re-issue from Privy/Turnkey/wallet).
3. If the wallet holds funds: `transferOwnership` the executor to a fresh operator address while the old key still works, OR pause via on-chain emergency switch.
4. Update `~/.zshenv` with the new key (operator does this manually, NEVER an AI).
5. File an incident note in `ai/incidents/YYYY-MM-DD-leak.md` with: what leaked, how, blast radius, mitigation timeline.
6. Add the failure mode to the project's threat model in `ai/sponsor-integration.md`.

## Untrusted text reaching the DOM

The interface renders by concatenating HTML strings and assigning them to `innerHTML`.
That is a deliberate choice, and it is the one place in this project where attacker
influenced text meets an execution sink, so it is written down rather than assumed safe.

**What is attacker influenced.** Anything read back from a chain or an API: asset symbols,
recipient labels, addresses, bundle roots, error messages returned by a node. A token can be
deployed under any name its author likes, including `<img src=x onerror=...>`. Fixture data is
authored in this repository and is not hostile, but it travels the same code path, so no
distinction is made at render time.

**The control.** Every interpolation is passed through `escapeHtml`, which replaces
`& < > ' "` with entities. Nothing reaches `innerHTML` unescaped unless it is a literal in
the source.

**How the control is enforced.** `tests/phase3/render-safety.test.ts` does two things.
It reads `apps/web/src/main.ts` and walks every interpolation in the file, failing unless each
one is escaped or provably a literal. Then it imports `escapeHtml` and asserts what it does to
hostile input: the five characters individually, plus the payloads this product invites, such as
an asset symbol of `<img src=x onerror="alert(1)">` and an attribute-breaking `" onmouseover=`.

`escapeHtml` lives in `apps/web/src/view-model.ts` rather than `main.ts` for that reason.
`main.ts` renders at import time, so a test cannot import it, and an earlier version of this
suite settled for checking that the five characters appeared somewhere in the function's source
text. That check was weak enough to pass a broken implementation: removing `<` from the escape
pattern leaves `"<": "&lt;"` in the body, so the source still contained the character while the
function no longer escaped it. The behavioural tests fail on exactly that edit.

This is not theoretical. Two unescaped interpolations shipped and were caught by a pre-push hook,
and a third, `state.selected.asset.symbol`, was found only when that test was written.

**Known limitation, stated plainly.** This is a convention enforced by a test, not a structural
guarantee. Building DOM nodes and assigning `textContent` would make the class of bug impossible
rather than merely detected. The pre-push gate flags every `innerHTML` in changed files for
exactly this reason and has to be overridden deliberately, per push, with `ALLOW_HTML_SINKS=1`.
Treat that override as a decision to re-check the test above, not as a formality.

## Default deny

If any tool, hook, or workflow is unclear about whether it might touch a key — assume YES and apply the rules. This file is the canonical source. Project-level deviations require explicit operator approval.
