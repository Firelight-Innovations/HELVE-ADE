# Helve

The entry point for the Helve stack. Organizes and loads the dev tools and
holds the shared baseline code that glues everything together and gets the
stack running.

Each dev tool may end up integrated as something like a separate web app
loaded into this — exact approach still being worked out. Tech stack and
how engine building fits in are also still being determined.

This is a development tool; it does not ship with games built on Helve.

Status: pre-alpha, scaffolding only.

## The stack

Helve is deliberately **multi-repo**, not a monorepo — each piece below is
its own repository, tagged with the `helve` and `helve-stack` topics on
GitHub so they cluster together. This repo (`helve`) is the one that ties
them together at runtime; it doesn't contain their code.

| Repo | What it is | Ships with a game? |
|---|---|---|
| [helve-engine](https://github.com/Firelight-Innovations/helve-engine) | Runtime core (Rust) — lighting, audio playback, spatial audio built in | **Yes** |
| [helve-forger](https://github.com/Firelight-Innovations/helve-forger) | Technical design software — specs out the stack and its boundaries | No |
| [helve-journeyman](https://github.com/Firelight-Innovations/helve-journeyman) | Game design software — design prototyping, rough playable systems | No |
| [helve-turner](https://github.com/Firelight-Innovations/helve-turner) | Procedural art system — generates art from an artist's rough shape | No |
| [helve-scrivener](https://github.com/Firelight-Innovations/helve-scrivener) | Narrative/dialogue authoring tool | No |
| [helve-quickener](https://github.com/Firelight-Innovations/helve-quickener) | NPC behavior / AI tooling | No |
| [helve-wright](https://github.com/Firelight-Innovations/helve-wright) | Audio authoring/composition tooling | No |

Each repo cuts tagged semantic-version releases (`v0.1.0`, ...) rather than
tracking a floating branch tip. `helve` pins to specific tagged versions of
each component, not to branch heads.
