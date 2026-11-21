# The Project Management MVP web app

## Business Requirements

This project is building a Project Management App. Key features:
- A user can sign in
- When signed in, the user sees a Kanban board representing their project
- The Kanban board has fixed columns that can be renamed
- The cards on the Kanban board can be moved with drag and drop, and edited
- There is an AI chat feature in a sidebar; the AI is able to create / edit / move one or more cards

## Limitations

For the MVP, there will only be a user sign in (hardcoded to 'user' and 'password') but the database will support multiple users for future.

For the MVP, there will only be 1 Kanban board per signed in user.

For the MVP, this will run locally (in a docker container). Phase 3 also puts it online as a public demo (see Technical Decisions).

## Technical Decisions

- NextJS frontend, built as a static export
- Python FastAPI backend
- Use "uv" as the package manager for python (Python 3.12)
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root (locally) or a Vercel environment variable (hosted)
- Use `openai/gpt-oss-120b` as the model
- Postgres on Supabase for the database; the schema lives in `supabase/migrations/`. Local development and tests use the Supabase CLI (`npx supabase start`)
- Locally, everything runs in one Docker container (FastAPI also serves the static site at /), with start and stop scripts for Mac, PC, Linux in scripts/
- Hosted as a public demo on Vercel: one project with two services (`frontend` static site, `backend` FastAPI) defined in `vercel.json`. Every branch push gets a protected preview deployment on the preview Supabase project; `main` deploys to production on the production Supabase project
- Public demo safeguards: "Try the demo" guest accounts that expire after 24 hours and are deleted by a daily Vercel schedule, daily AI message limits per account and for the whole site, a Vercel Firewall rate limit on sign-in, sign-up, and demo starts, and no seeded accounts on hosted databases

## Starting Point

A working MVP of the frontend has been built and is already in frontend. This is not yet designed for the Docker setup. It's a pure frontend-only demo.

## Color Scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding.