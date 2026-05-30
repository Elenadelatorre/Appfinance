# 🚀 Guía de Despliegue: Vercel + Render

Esta guía resume el despliegue de la app en producción con frontend estático en Vercel y backend en Render.

## Requisitos

- Cuenta en [Render](https://render.com)
- Cuenta en [Vercel](https://vercel.com)
- Repositorio en GitHub
- MongoDB Atlas configurado

## Arquitectura

- Vercel sirve el frontend desde `frontend/`
- Render expone la API FastAPI desde `backend/`
- La API se conecta a MongoDB Atlas

## Backend en Render

1. Crea un Web Service en Render.
2. Conecta el repositorio y la rama `main`.
3. Usa estos valores:
   - Build Command: `pip install -r backend/requirements.txt`
   - Start Command: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`
4. Añade las variables de entorno:
   - `MONGO_URL=mongodb+srv://<db_user>:<db_password>@cluster0.uq2uebh.mongodb.net/`
   - `DB_NAME=finance`
   - `JWT_SECRET=<clave-larga-y-aleatoria>`
   - `ACCESS_TOKEN_EXPIRE_DAYS=30`
   - `CORS_ORIGINS=https://tuapp.vercel.app,http://localhost:3000`
   - `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`
5. Despliega y prueba `https://tu-backend.onrender.com/docs`.

## Frontend en Vercel

1. Crea un proyecto en Vercel desde el mismo repositorio.
2. Configura el directorio de salida para servir `frontend/`.
3. Asegúrate de que `frontend/index.html` tenga la URL real de la API:

```html
<meta name="finance-api-base" content="https://tu-backend.onrender.com/" />
```

4. Despliega y abre la URL pública.

## Verificación

- Login y registro deben apuntar a la API de Render.
- Si aparece un error CORS, revisa `CORS_ORIGINS`.
- Si la API no responde, revisa los logs de Render y la variable `MONGO_URL`.

## Seguridad

- No subas credenciales reales al repositorio.
- Usa secretos fuertes para `JWT_SECRET`.
- Rota cualquier credencial expuesta en historial antiguo.
