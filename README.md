# MemoryPets

A floating companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that remembers the user's working memory (name, phone, address, employer, GitHub accounts, API keys, etc.) and injects it into the conversation context.

The companion itself is a 720×720 PNG sprite sequence in four moods (`standing / thinking / waitting / sleeping`). Mood is automatic when harness activity is observable and can be overridden manually for debugging.

## Layout

```
harness-plugin/
├── packages/
│   ├── memorypets/              # Host: vault + crypto + service
│   │   ├── src/crypto.ts        # Web Crypto primitives (PBKDF2 + AES-GCM)
│   │   ├── src/vault.ts         # Locked snapshot + unlock/seal
│   │   ├── src/index.ts         # Cordis plugin: ctx.memoryPets
│   │   └── src/tools.ts         # dsh tool: reveal credential by label
│   └── memorypets-client/       # Client: floating pet UI + manager
│       ├── src/animation.ts     # Mood + frame sequences
│       ├── src/hooks/           # useSpriteFrames, useAutoMood
│       ├── src/ui/              # FloatingPet, FloatingPets, UnlockDialog, MemoryManager
│       ├── src/MemoryPetsApp.tsx# 顶层容器
│       └── src/index.tsx        # Cordis plugin + system prompt section
├── examples/
│   └── cordis.yml               # 装载示例（用 localStorage 存 envelope）
└── assets/                      # 动画 PNG 序列
```

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