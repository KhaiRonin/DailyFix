# DailyFix

DailyFix is a public learning log where I research real developer problems and publish practical fixes with source links, notes, and minimal examples.

The goal is to build a useful archive, not empty activity. Each entry should explain the problem, why it happens, how to fix it, and how to verify the result.

## How It Works

Generate a daily draft:

```bash
npm run daily:solution
```

Generate from a custom topic:

```bash
npm run daily:solution -- --topic="Supabase session is null after refresh" --source="https://supabase.com/docs/guides/auth/sessions"
```

After editing today's entry, commit it:

```bash
npm run daily:solution -- --commit-today
```

Commit and push today's entry:

```bash
npm run daily:solution -- --push-today
```

## Entry Standard

Each entry should include:

- The original problem or question.
- A short root cause explanation.
- A practical fix.
- A minimal code example.
- Links to official docs, issue threads, or reliable references.
