# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

---

## Security Model & Threat Boundaries

Comfy Deck is designed to operate on **trusted local area networks (LANs)** or **localhost loopback**:
- The dashboard is intentionally lightweight and does not implement a multi-user authentication system.
- Do not expose Comfy Deck or upstream ComfyUI/LM Studio ports directly to the public Internet without a secure VPN or authenticated reverse proxy.
- All local process controls (ComfyUI / LM Studio daemon management) are constrained to verified local processes and same-origin verification.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in Comfy Deck, please report it responsibly:

1. **Do not create a public issue** on GitHub.
2. Report the vulnerability privately via [GitHub Private Vulnerability Reporting](https://github.com/How-e/ComfyUIMobileDash/security/advisories/new) or contact the project maintainer directly.
3. Include detailed steps to reproduce the issue, the affected versions, and any possible mitigations.

We will acknowledge reports promptly and work to release patches as quickly as possible.
