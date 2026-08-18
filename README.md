# MemoryPets

A floating companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that remembers the user's working memory (name, phone, address, employer, GitHub accounts, API keys, etc.) and injects it into the conversation context.

The companion itself is a 720×720 PNG sprite sequence in four moods (`standing / thinking / waitting / sleeping`). Mood is automatic when harness activity is observable and can be overridden manually for debugging.

## Layout

```
harness-plugin/
├── packages/
│   ├── host/                    # @memorypets/host — vault + crypto + service + tools
│   │   └── lib/
│   │       ├── crypto.mjs       # Web Crypto primitives (PBKDF2 + AES-GCM)
│   │       ├── vault.mjs        # Locked snapshot + unlock/seal
│   │       ├── index.mjs        # Cordis plugin: ctx.memoryPets, HTTP routes, direct-apply bypass
│   │       ├── operations.mjs   # Shared vault actions (status/list/upsert/remove/reveal) —
│   │       │                    #   single source of truth used by both tools.mjs and index.mjs
│   │       ├── intent.mjs       # Code-word detection + LLM-free intent parser
│   │       ├── override-prompt.mjs # High-priority systemPrompt override text
│   │       └── tools.mjs        # dsh tools: memorypets_status/list_entries/upsert/remove_entry/reveal_credential
│   └── client/                  # @memorypets/client — floating pet UI + manager
│       └── lib/
│           ├── index.mjs        # Host-side stub (registers the client bundle for dsh-client-modules)
│           ├── client.mjs       # Browser-side plugin source (React.createElement, no JSX)
│           └── client.bundle.js # Bundled browser output served at /plugins/@memorypets/client/client.js
├── examples/
│   └── cordis.yml               # 装载示例（用 localStorage 存 envelope）
└── assets/                      # 动画 PNG 序列
```

> **Note:** this repository currently ships only the compiled `.mjs` output under
> `packages/*/lib/`; there is no separate TypeScript `src/` build step yet
> (the `build`/`typecheck`/`lint` scripts in the root `package.json` are
> no-ops until each package gains its own `scripts` + TS source).

## Security model

- **Encryption**: AES-GCM-256. Derivation is PBKDF2-SHA-256 with 250 000 iterations and a per-vault random salt.
- **Master password**: never persisted. Lives only in a React ref for the duration of the unlocked session.
- **Credentials vs working memory**: profile / work entries may flow into the system prompt. Credentials never enter the prompt; they are surfaced only via the explicit `memorypets_reveal_credential` tool, which requires the vault to be unlocked.
- **Vault envelope** is serializable JSON (`{ version, kdf, ciphertext, iv }`). The example persists it to `localStorage`; production deployments should use a more durable channel such as `dsh-settings-file`.

## Moods

| Mood      | Trigger                                              |
|-----------|------------------------------------------------------|
| standing  | Default. Manual switcher always available.           |
| thinking  | `agent` is in-flight and a token chunk arrived <1.5s |
| waitting  | Agent is in-flight but stalled >1.5s                 |
| sleeping  | No user interaction for >30s                         |

Manual mood override disables auto mood until cleared.

## Status

Skeleton. Crypto and vault implementations compile against Web Crypto and pass the dsh registry conventions (`export const name / inject / apply`). UI components compile against React 18. No automated tests yet; the PoC needs to be loaded into a live `dsh web` profile via the example `cordis.yml` patch.

The vault actions (status / list / upsert / remove / reveal) live in a single
shared module (`packages/host/lib/operations.mjs`) that both the LLM-facing
tools (`tools.mjs`) and the code-word direct-apply HTTP bypass (`index.mjs`)
call into, so the two entry points can never drift out of sync with each
other.