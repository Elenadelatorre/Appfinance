# Frontend Configuration

This document explains how to configure the Finance App frontend for different environments.

## API Base URL Configuration

The frontend supports multiple ways to configure the backend API URL:

### Priority Order (highest to lowest):

1. **Query Parameter** (¿api=...)

   ```
   https://yourapp.vercel.app/?api=https://finance-app-api.onrender.com
   ```

2. **LocalStorage** (set via browser DevTools)

   ```javascript
   localStorage.setItem(
     'financeApiBaseUrl',
     'https://finance-app-api.onrender.com'
   );
   location.reload();
   ```

3. **Meta Tag** (edit index.html)

   ```html
   <meta
     name="finance-api-base"
     content="https://finance-app-api.onrender.com"
   />
   ```

4. **Auto-detect localhost**
   - If you open the app on `localhost` or `127.0.0.1`, it defaults to `http://127.0.0.1:8001`

5. **Empty** (default)
   - If no API is configured and URL is not localhost, API_URL will be empty
   - This causes all API calls to fail with CORS/404 errors

## Recommended Approaches

### Local Development

Run both frontend and backend locally:

```bash
# Terminal 1: Backend
cd backend
uvicorn app.main:app --reload

# Terminal 2: Frontend
cd frontend
python -m http.server 4173
```

Then open: http://localhost:4173

The frontend auto-detects and uses `http://127.0.0.1:8001`.

### Production (Vercel + Render)

Edit [index.html](index.html) before deploying:

```html
<meta name="finance-api-base" content="https://finance-app-api.onrender.com" />
```

Or set it after deploying via the query parameter in your bookmarks:

```
https://yourapp.vercel.app/?api=https://finance-app-api.onrender.com
```

### Development with Remote Backend

If you want to test against a remote backend while developing locally:

```
http://localhost:4173/?api=https://finance-app-api.onrender.com
```

## Code Reference

The configuration is handled in [app.js](app.js#L15-L35):

```javascript
const API_STORAGE_KEY = 'financeApiBaseUrl';
const DEFAULT_LOCAL_API = 'http://127.0.0.1:8001';

function resolveApiBase() {
  const params = new URLSearchParams(globalThis.location.search);
  const fromQuery = normalizeApiBase(params.get('api'));
  if (fromQuery) {
    localStorage.setItem(API_STORAGE_KEY, fromQuery);
    return fromQuery;
  }

  const fromStorage = normalizeApiBase(localStorage.getItem(API_STORAGE_KEY));
  if (fromStorage) return fromStorage;

  const fromMeta = normalizeApiBase(
    document
      .querySelector('meta[name="finance-api-base"]')
      ?.getAttribute('content')
  );
  if (fromMeta) return fromMeta;

  const host = globalThis.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  return isLocal ? DEFAULT_LOCAL_API : '';
}

const API = resolveApiBase();
```

## Troubleshooting API Connection

### API URL is Empty

If DevTools console shows `API: ''`:

1. Check if you're on localhost
2. Add the API URL to one of:
   - Meta tag in index.html
   - Query parameter: `?api=...`
   - Or use localhost dev setup

### CORS Error

If you see CORS errors in DevTools Network tab:

1. Backend needs to allow-origin
2. In [backend/app/main.py](../backend/app/main.py), the backend should include:

   ```python
   CORS_ORIGIN_REGEX = r"https://.*\.vercel\.app"
   ```

3. Set correct environment variables on your backend service:
   ```
   CORS_ORIGINS=https://yourapp.vercel.app
   ```

### 404 on API Calls

If all API calls return 404:

1. Verify the API URL is correct
2. Test it in browser: `https://your-api.com/`
3. Check that the API service is running

---

See [DEPLOYMENT.md](../DEPLOYMENT.md) for full deployment instructions.
