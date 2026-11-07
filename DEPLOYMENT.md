# Hosting Team Desk

Use your own hosting account and a new private data store for this installation.

## Vercel

1. Upload this source to a repository you control, or deploy the extracted project with the Vercel CLI.
2. Create a Vercel project using the Next.js framework and Node.js 24. The project root is the folder containing `package.json`.
3. Create a private Vercel Blob store for this application and connect it to the project. The server reads `BLOB_READ_WRITE_TOKEN` from its environment.
4. Deploy with install command `npm ci` and build command `npm run build`.
5. Open the deployment and add your team, meetings, and tasks. Verify a saved task still exists after refreshing the page.

The workspace is stored as `team-desk/workspace-v1.json` in the connected private Blob store. No storage credentials are sent to the browser. Do not put access tokens in source files or variables prefixed with `NEXT_PUBLIC_`.

Use separate stores for production and test deployments. Instances using the same store and object path share the same workspace data.

## Persistence

Local development without Blob credentials uses `.data/workspace.json`. Hosted production requires Blob storage and fails with an error if it is not configured; it never treats temporary server files as durable storage.

Writes protect against concurrent updates. If two people edit the same record, the later save receives a conflict instead of silently overwriting the first person's work. Retrying an uncertain save does not duplicate the operation.

The application refreshes on opening, manually through Refresh, and when the browser regains focus after more than a minute. It does not continuously stream changes from other users.

## Access

The application has no authentication. Its API allows anyone who can reach the app to read and edit workspace data. Private Blob storage restricts direct object access; it does not restrict the application's own pages or API.
