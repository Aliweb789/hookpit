# Contributing to Hookpit

Thanks for helping! Hookpit is small and approachable, so this is a good first open-source project to contribute to. All skill levels are welcome.

## Ways to help
- Pick an issue labelled **good first issue**
- Report a bug or suggest a feature (use the issue templates)
- Improve the docs, since typos and unclear steps count too
- Test the Docker setup on your machine and tell us what happened

## Set up locally

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/<your-username>/hookpit.git
cd hookpit
npm install
npm run build -w apps/api
npm run start -w apps/api      # API on :4000
npm run dev:web                # dashboard on :3000 (second terminal)
```

For API changes, `npm run dev:api` rebuilds automatically.

## Project layout
- `apps/api` is the NestJS server (`capture/` holds the endpoint and capture logic, `db/` the SQLite setup)
- `apps/web` is the Next.js dashboard (App Router)

## Submitting a change

1. **Fork** the repo and create a branch: `git switch -c feat/short-description`
2. Make your change. Keep it focused: one idea per pull request.
3. Make sure both apps still build: `npm run build`
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`
5. Push and open a pull request. Describe *what* changed and *how you tested it*.

## Continuous integration (CI)

Every pull request automatically runs [GitHub Actions](.github/workflows/ci.yml), which installs dependencies with `npm ci` and runs `npm run build` on Node 20. A PR needs a green check before it is merged.

If CI fails on your PR, open the failing run from the PR's **Checks** tab to see the log. You can reproduce it locally with:

```bash
npm ci
npm run build
```

Not sure whether an idea fits? Open an issue first and we'll talk it through before you spend time on code.

## Guidelines
- **Never build SQL by string concatenation.** Use `?` placeholders.
- **Don't parse or modify captured bodies.** Hookpit shows exactly what arrived.
- Features that make requests to user-supplied URLs (like replay) must block internal addresses on public instances (SSRF protection).
- Be kind. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## License
By contributing, you agree your work is released under the [MIT License](LICENSE).
