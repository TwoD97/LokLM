# Architecture Decision Records (ADRs)

This directory holds short records of the architectural decisions that shape
LokLM. Each ADR is one markdown file in this folder, numbered sequentially.

## Format

File name: `NNNN-short-title.md` (e.g. `0001-electron-vite.md`).

Each ADR should include the following sections:

- **Status** — proposed, accepted, deprecated, superseded by ADR-XXXX
- **Context** — what's the problem, what constraints apply
- **Decision** — what we chose
- **Consequences** — what becomes easier, what becomes harder

Decisions should reference, where useful, **production deployments** that have made the same call (Bitwarden/Vaultwarden, 1Password, age, Signal, AWS KMS, …) — concrete prior art is worth more than abstract justification.

Referenced from [Pflichtenheft](../../Pflichtenheft_LokLM.md) §1.5 as `[ADR-NNNN]`.

## Index

| #    | Titel                                                                                          | Status   |
| ---- | ---------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Argon2id als Passwort-/Passphrase-KDF](0001-argon2id-password-kdf.md)                         | accepted |
| 0002 | [Envelope-Encryption: DEK + KEK-Wrapping mit AES-256-GCM](0002-envelope-encryption-aes-gcm.md) | accepted |
| 0003 | [Query-Routing + Per-Dokument-Summary-Index](0003-query-routing-und-summary-index.md)          | accepted |

## Verwandte Dokumente

- [Third-Party Licenses](../licenses.md) — Attribution- und Lizenz-Inventar aller direkten Abhängigkeiten. ADRs nennen Pakete im Kontext einer Entscheidung; dort steht die vollständige Liste mit Versionen, Lizenzen und Copyright-Inhabern.
