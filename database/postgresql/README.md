# PostgreSQL preparation

This directory contains a review-only PostgreSQL schema draft. It is not loaded
by the application, and PostgreSQL has not been installed or configured.

The approved migration boundary is:

- authoritative source: `database/digital-time-capsule.sqlite`
- Python compatibility database: `backend/data/capsules.sqlite3`, unchanged
- media: existing filesystem-backed storage, unchanged
- application database: SQLite until a later explicit cutover approval

## Read-only inventory

From the project root, inspect the authoritative database without applying
SQLite migrations or changing any files:

```sh
npm run inventory:sqlite
npm run inventory:sqlite -- --json
npm run inventory:sqlite -- --db path/to/database.sqlite --media path/to/media
```

The report includes table counts, columns, indexes, foreign keys, foreign-key
violations, media references, and media files present on disk. The command opens
SQLite in read-only mode and must be run before any future migration.

## Schema draft

[`schema.sql`](./schema.sql) mirrors the current Node schema, including:

- ownership and cascading relationships
- locked/unlocked capsule state
- conversations and timestamped messages
- embedding metadata and JSON vectors
- image-analysis status and descriptions
- notification and email-delivery state
- revoked tokens and admin audit records

It is intentionally not executable by the application yet. A future migration
must add versioned migrations, a PostgreSQL integration test database, data
validation, backup/restore procedures, and an explicit cutover/rollback plan.
