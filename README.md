# Team Desk

A simple shared task and meeting management system with English and Arabic interfaces.

## Features

- Kanban task board with assignments, priorities, due dates, and change history.
- Meetings with agendas, minutes, decisions, and next steps.
- Link a task to several meetings and filter the board by meeting.
- Carry unfinished tasks forward while keeping earlier meeting links and history.
- Archive and restore records; export workspace backups and meeting minutes.
- Roboto typography, Arabic text support, and responsive layouts.

The application starts empty. Add your team members, meetings, and tasks after opening it.

## Run locally

Install Node.js 24 and npm, extract this archive, and open a terminal in the folder containing `package.json`.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Development data is saved in `.data/workspace.json` and survives restarts. Keep a copy of that file if you need to move your local data. It is not included in this archive.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Tests use temporary local fixtures and do not require a hosted workspace. `npm start` serves the production build and requires shared storage; see `DEPLOYMENT.md`.

## Using the system

1. Open Team to add the people who will receive tasks.
2. Add meetings in the Meetings tab, including their minutes and decisions.
3. Select a meeting on the Tasks tab. New tasks automatically link to it.
4. Open a task to edit its status, assignee, or linked meetings.
5. Choose Carry unfinished tasks to share selected tasks with another meeting without creating duplicates.
6. Use History to inspect changes and export a workspace backup.

The selected language, meeting filter, and Working as name are remembered in the browser. A shared task has one current status and one history across its meetings.

## Access and backups

There is no login. Anyone who can reach a deployed instance can view and edit its workspace. Working as records a self-selected name in history; it is not a verified identity.

Workspace exports contain your data. Save periodic copies somewhere you control. The app supports backup downloads but does not provide a full-workspace restore button. Archived records can be restored inside the app.

This package contains source code and generic tests only. Dependencies, stored workspace data, access credentials, and deployment account settings are not included.
