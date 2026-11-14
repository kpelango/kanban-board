# Frontend Architecture and Codebase Guide

## Overview

The `frontend/` directory contains a Next.js 16 (App Router) React 19 TypeScript application that implements the Kanban Studio workspace. In its initial state, it is a pure client-side demo using local React state, configured to be built as a static export (`output: "export"`) and served by the FastAPI backend.

## Tech Stack

- **Framework**: Next.js 16 (`next`), React 19 (`react`, `react-dom`), TypeScript 5
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`, `tailwindcss`) with custom CSS variables in `src/app/globals.css` and `clsx` for conditional classes
- **Drag and Drop**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- **Unit Testing**: Vitest (`vitest`), React Testing Library (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`), `jsdom`
- **E2E Testing**: Playwright (`@playwright/test`)

## Directory Structure

- `src/app/`
  - `layout.tsx`: Root HTML layout, loads `Space_Grotesk` (display) and `Manrope` (body) Google fonts and imports global styles.
  - `page.tsx`: Entry route (`/`) rendering the `KanbanBoard` component.
  - `globals.css`: Defines the color palette CSS variables (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`, `--gray-text`, surfaces, and shadows) and base typography rules.
- `src/components/`
  - `LoginForm.tsx`: Client sign-in form posting credentials to `POST /api/auth/login` and displaying validation errors.
  - `LoginForm.test.tsx`: Vitest tests covering unauthenticated redirect, invalid credentials alert, sign-in transition, and logout.
  - `ChatSidebar.tsx`: Docked right-hand AI assistant sidebar maintaining conversation history in React state, posting messages to `POST /api/chat`, and triggering automatic board updates when Structured Outputs include an updated `BoardData`.
  - `KanbanBoard.tsx`: Top-level stateful client component (`"use client"`). Manages `BoardData`, configures `@dnd-kit` pointer sensors and `DndContext`, handles drag start/end events, column renaming, card creation, card editing, card deletion, and `ChatSidebar` integration, and renders the board header (with user badge, AI Assistant toggle, and logout button), five `KanbanColumn` components, and `DragOverlay`.
  - `KanbanColumn.tsx`: Droppable column container (`useDroppable`) with an editable column title input, card count badge, `SortableContext` list of `KanbanCard` items, empty drop state, and a `NewCardForm` at the bottom.
  - `KanbanCard.tsx`: Draggable/sortable card item (`useSortable`) displaying card title, details, and action controls (edit and remove).
  - `KanbanCardPreview.tsx`: Presentational card component rendered inside `DragOverlay` while dragging.
  - `NewCardForm.tsx`: Collapsible inline form inside each column for adding a new card with `title` and `details`.
  - `KanbanBoard.test.tsx`: Vitest + React Testing Library component tests for rendering columns, renaming columns, and adding/removing cards.
- `src/lib/`
  - `api.ts`: Client helper functions (`fetchBoard`, `saveBoard`, `sendChatMessage`) for reading/persisting `BoardData` (`GET /api/board`, `PUT /api/board`) and interacting with the AI assistant (`POST /api/chat`).
  - `kanban.ts`: Core types (`Card`, `Column`, `BoardData`), `initialData` seed state with 5 fixed columns (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`) and 8 sample cards, `moveCard` pure state transition function for reordering/moving cards across columns, and `createId` helper.
  - `kanban.test.ts`: Unit tests for `moveCard` (reordering within a column, moving across columns, dropping onto a column container).
- `src/test/`
  - `setup.ts` & `vitest.d.ts`: Test environment setup importing `@testing-library/jest-dom`.
- `tests/`
  - `kanban.spec.ts`: Playwright E2E tests covering board load, adding a card, and mouse drag-and-drop between columns.

## Color Tokens

Defined in `src/app/globals.css`:
- `--accent-yellow`: `#ecad0a`
- `--primary-blue`: `#209dd7`
- `--secondary-purple`: `#753991`
- `--navy-dark`: `#032147`
- `--gray-text`: `#888888`

## Commands

- `npm run dev`: Start Next.js development server
- `npm run build`: Build production bundle / static export (`out/`)
- `npm run lint`: Run ESLint
- `npm run test:unit`: Run Vitest unit and component tests once
- `npm run test:e2e`: Run Playwright end-to-end tests
- `npm run test:all`: Run both unit and E2E test suites

