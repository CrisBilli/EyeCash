# Security policy

EyeCash holds some of the most sensitive data a person has, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: *Security → Report a vulnerability* on this repository. Include:
- what an attacker could do and under which conditions (network position, logged in or not…);
- steps to reproduce, with invented data only;
- the version (shown in *Impostazioni → Informazioni*, or `cat VERSION`).

You should get a first answer within a week. Fixes are released as soon as possible, and credited to you if you wish.

## Security model in short

- Data is encrypted in the browser (AES-256-GCM, key from PBKDF2-SHA256 with 600,000 iterations). The server stores ciphertext only and never receives the password.
- The server listens on `127.0.0.1`; remote access is meant to go through a private network such as Tailscale, or a reverse proxy with HTTPS that you control.
- Session cookies are HttpOnly and `SameSite=Strict`; state-changing requests need a custom header and same-origin `Sec-Fetch-Site`; logins are rate-limited.
- Strict Content-Security-Policy, no inline scripts, no third-party code at run time, no dependencies.
- On the device: auto-lock after a chosen time away, content blurred in the app switcher, encrypted data padded to 16 KB blocks, encrypted backups instead of readable exports.
- The MCP endpoint is write-only and uses revocable tokens.
- AI features send only minimal, anonymised data, each behind its own switch. With a local model nothing leaves your network.

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Out of scope

- Attacks that need the user's unlocked device or password.
- Exposing the app directly to the internet without HTTPS, against the installation guide.
- Denial of service from inside the user's own private network.
