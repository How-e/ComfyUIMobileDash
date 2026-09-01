# Contributing to Comfy Deck

Thank you for your interest in contributing to Comfy Deck! We welcome bug fixes, improvements, and feature contributions from the community.

---

## Getting Started

### Prerequisites
- **Node.js**: version 20 or higher
- **ComfyUI**: running locally or reachable on your LAN (optional for core unit tests, required for integration tests)
- **LM Studio** *(Optional)*: with the `llmster` headless runtime installed for Prompt Studio testing

### Setup
1. Fork and clone the repository:
   ```bash
   git clone https://github.com/How-e/ComfyUIMobileDash.git
   cd ComfyUIMobileDash
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment configuration:
   ```bash
   cp .env.example .env.local
   ```
4. Start development mode:
   ```bash
   npm run dev
   ```

---

## Development & Testing

### Running Tests
We use Node.js's native test runner for fast, dependency-free testing:
```bash
npm test
```

### Privacy & Secret Checks
Every contributor must ensure no personal directories, passwords, tokens, or private emails are committed:
```bash
npm run privacy:check
```

### Building
To test production builds and the release bundle:
```bash
# Build frontend
npm run build

# Build complete clean release bundle
npm run build:release
```

---

## Architectural Principles

1. **Lightweight & Fast**: Minimize third-party dependencies. Keep resource footprint low so GPU/CPU power stays available for image/video generation.
2. **Touch-First Mobile UX**: Ensure all new UI components are responsive and keyboard-accessible, keep interactive targets at least 44 × 44 CSS pixels, preserve visible focus, and verify both 320 px and 390 px phone widths without horizontal overflow.
3. **Loopback & LAN Security**: Comfy Deck is designed for private local networks. Do not introduce features that require cloud telemetry or unauthenticated remote access.
4. **Non-Destructive Workflows**: Preserving intact workflow inputs, links, and node metadata is critical.

---

## Submitting Pull Requests

1. Create a feature branch (`git checkout -b feature/my-new-feature`).
2. Implement your changes and add corresponding unit tests in `tests/`.
3. Verify that `npm test`, `npm run privacy:check`, and `npm run build` all pass.
4. Commit your changes with clear, descriptive commit messages.
5. Open a Pull Request on GitHub against the `main` branch.
