# Frontend Architecture and Codebase Guide

## Overview

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4. Built as a static export (`output: "export"`) and served by FastAPI, so all data comes from relative `/api/*` calls. `npm run dev` has no backend; use the Docker container for end-to-end work.

## Structure

- `src/app/page.tsx`: checks `/api/auth/me`, renders `AuthScreen` or `Workspace`.
- `src/app/layout.tsx`, `globals.css`: fonts (Bricolage Grotesque display, Atkinson Hyperlegible body) and color tokens exposed as Tailwind colors (`navy`, `yellow`, `blue`, `purple`, `muted` and `link` (darker text shades of the brand gray and blue that pass WCAG AA; use them for text, keep `blue` for borders and focus), `ink`, `ink-soft`, `surface`, `lane`, `stroke`, `danger`), and `.font-numeral` (condensed Bricolage for stage numbers).
- `src/lib/api.ts`: typed fetch helpers for every endpoint; errors throw `ApiError` with the server's `detail` (show them with `errorText(err, fallback)`); any 401 outside sign-in fires `SESSION_EXPIRED_EVENT`, which `page.tsx` turns into a return to sign-in with a notice.
- `src/lib/format.ts`: server timestamp (UTC) and due-date formatting.
- `src/lib/boardFile.ts`: export file format (`{kanbanStudio: 1, name, board}`), file names, and import parsing (bare BoardData also accepted).
- `src/lib/kanban.ts`: types, `PRIORITY_LABELS`, `newCard`, and pure `BoardData -> BoardData` operations (`insertCard`, `deleteCard`, `moveCard`, `moveCardToColumn`, `archiveCards`, `restoreCard`, `deleteArchivedCard`) plus filters, `boardStats`, `isOverdue`, `parseLabels`, `todayISO`. Board handlers in components should call these rather than build board objects inline. The sample board used by tests is `src/test/fixtures.ts`.
- `src/components/`
  - `Workspace.tsx`: app shell. Owns the board list, active board, `BoardData`, filters, and chat/account state. `updateBoard` applies changes optimistically and queues `PUT` saves in order. Remembers the last board per user in `localStorage`.
  - `BoardMenu.tsx` (switch, create, rename, delete, duplicate, export/import JSON boards), `BoardToolbar.tsx` (search with `/` shortcut, priority, label, and due-date filters, stats), `AccountDialog.tsx` (change password, delete account), `ArchiveDialog.tsx` (restore or permanently delete archived cards), `UsersDialog.tsx` (admins: reset passwords, grant or remove admin, delete users), `AuthScreen.tsx` (sign in and register).
  - `KanbanBoard.tsx`: dnd-kit context (mouse, touch with press delay, keyboard sensors), mobile column tabs, card dialog, undo toast for deleted cards. `KanbanColumn.tsx` (inline title committed on blur/Enter, WIP limit dialog), `KanbanCard.tsx` (`CardFace` + sortable wrapper: pointer drag anywhere, keyboard drag via the grip handle so the card never nests interactive elements), `CardDialog.tsx` (title, details, priority, due date, labels, checklist via `ChecklistEditor.tsx`, column), `NewCardForm.tsx`.
  - `ChatSidebar.tsx`: per-board conversation list, new chat (created on first send), rename, delete; applies `board` from AI replies via `onBoardUpdate`.
  - `ui.tsx`: `Modal`, `useDismiss`, `CloseIcon`, shared button/input class strings, `ErrorText`.
- `src/test/setup.ts`: jest-dom matchers plus a `Blob.text()` polyfill (missing in jsdom).
- `src/test/fetchMock.ts`: `mockFetch({"METHOD /path": handler})` used by component tests.

## Layout

Design: the board is a flat whiteboard. Each column is a numbered stage (1-5) sitting on one continuous yellow flow rail, which turns red under a column that is over its WIP limit; cards are flat white with a priority tab on the top edge, and only lifted things (dragged card, dialogs, popovers) cast shadows. The header is a slim navy bar. The sign-in screen reuses the rail motif.

The board layout uses a container query on `<main>`: below 1152px of board width (`@6xl`, so also whenever the chat panel is open) the five lanes scroll horizontally with snap points and a numbered column tab strip; above it they form a 5-column grid. The chat is full screen on phones and a 420px right panel from `sm` up (the board gets right padding while it is open).

## Commands

- `npm run lint`, `npm run build`
- `npm run test:unit` (Vitest); `npx vitest run src/lib/kanban.test.ts -t "name"` for one test
- `npm run test:e2e` (Playwright against `BASE_URL`, default the container at `http://127.0.0.1:8000`); E2E tests use the `e2e-test-user` account and reset it first; `tests/a11y.spec.ts` runs axe-core (WCAG 2.1 AA) on every main screen at desktop and mobile sizes
