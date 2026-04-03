# Contributing to WorldSim

Thank you for your interest in contributing to WorldSim.

## Development Setup

```bash
git clone https://github.com/your-org/worldsim.git
cd worldsim
npm install
npm run build
```

## Running Tests

```bash
# Unit tests
npm test

# Integration tests (requires LLM provider credentials)
npm run test:integration

# Docker-based tests
npm run test:docker:up    # start services
npm run test:docker:down  # tear down services
```

## Code Style

- TypeScript strict mode is enabled; do not weaken it.
- Run `npx eslint .` before submitting. CI will enforce it.
- Avoid unnecessary comments. Let types and names speak.

## Pull Request Guidelines

- One concern per PR. Do not bundle unrelated changes.
- Every new feature must include tests.
- `npm run build` and `npm test` must pass before you open a PR.
- Fill in the PR template completely.

## Proposing New Evaluation Scenarios

We welcome new scenario ideas. See `evaluation/README.md` for the scenario format, then either:

1. Open an issue using the **Scenario Idea** template, or
2. Submit a PR adding your scenario YAML to `evaluation/scenarios/`.

## Reporting Bugs and Requesting Features

Use [GitHub Issues](../../issues) with the appropriate template:

- **Bug Report** -- for reproducible problems.
- **Feature Request** -- for enhancements and new capabilities.
- **Scenario Idea** -- for new evaluation scenarios.
