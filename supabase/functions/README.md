# Inventory Edge Functions

The Gemini API key must be stored as a Supabase project secret. Do not add it to this repository or the browser application.

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
supabase functions deploy generate-item-description
```

The deployed function uses Supabase's normal authenticated function invocation. The inventory UI calls it through `window.db.functions.invoke(...)`.
