# 🚀 Guía de Desarrollo - Finance App

## Configuración del Entorno Local

### 1. Clonar el Proyecto

```bash
cd finance_app
```

### 2. Backend: Python

#### Crear entorno virtual

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Linux/Mac
python3 -m venv .venv
source .venv/bin/activate
```

#### Instalar dependencias

```bash
cd backend
pip install -r requirements.txt

# Para desarrollo agregar herramientas
pip install -r requirements-dev.txt
```

#### Configurar variables de entorno

```bash
# Copiar template
cp ../.env.example .env

# Editar .env con valores locales
# JWT_SECRET=dev-key-change-in-production
# MONGO_URL=mongodb://localhost:27017
# DB_NAME=finance
```

#### Iniciar servidor

```bash
# Necesitas MongoDB corriendo en puerto 27017
# Con Docker:
docker run -d -p 27017:27017 mongo:7

# Luego ejecutar:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

### 3. Frontend: HTML/CSS/JS

```bash
# Simplemente abrir en navegador
open frontend/index.html

# O servir con Python
cd frontend
python -m http.server 3000

# Configurar API base sin tocar app.js:
# 1) editar meta[name="finance-api-base"] en index.html
# 2) o abrir una vez con: http://localhost:3000/?api=http://127.0.0.1:8001
```

## Estructura de Carpetas

```
finance_app/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # Configuración FastAPI y rutas principales
│   │   ├── auth.py           # Autenticación JWT
│   │   ├── routes.py         # Endpoints API
│   │   ├── models.py         # Modelos Pydantic (entrada)
│   │   ├── schemas.py        # Esquemas respuesta (salida)
│   │   ├── db.py             # Conexión MongoDB
│   │   ├── logic.py          # Lógica de negocio
│   │   └── logging_config.py # Configuración de logging
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── Dockerfile
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── sw.js              # Service Worker
│   └── manifest.webmanifest
├── docker-compose.yml
├── nginx.conf
├── .env.example
├── .gitignore
├── README.md
├── SECURITY.md
└── DEVELOPMENT.md
```

## Flujo de Desarrollo

### Crear una nueva ruta API

1. **Definir modelo en models.py:**

```python
class MyResourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    value: float = Field(gt=0)
```

2. **Crear lógica en logic.py:**

```python
async def my_business_logic(user_id: str, data):
    # Procesar datos
    return result
```

3. **Agregar endpoint en routes.py:**

```python
@router.post("/my-resource")
async def create_my_resource(
    payload: MyResourceCreate,
    user_id: str = Depends(get_current_user_id)
):
    result = await my_business_logic(user_id, payload)
    return fix_id(result)
```

4. **Consumir en frontend (app.js):**

```javascript
async function createMyResource(data) {
  const response = await api('/my-resource', {
    method: 'POST',
    json: true,
    body: JSON.stringify(data)
  });
  return response;
}
```

## Testing

### Pytest

```bash
cd backend
pytest tests/ -v --cov=app

# Test específico
pytest tests/test_auth.py::test_login -v

# Con cobertura
pytest --cov=app --cov-report=html
```

### Manual Testing con curl

```bash
# Registro
curl -X POST http://localhost:8001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com", "password":"Password123"}'

# Login
curl -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=user@test.com&password=Password123"

# Crear transacción (con token)
curl -X POST http://localhost:8001/transactions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":100.50, "type":"expense", "category_id":"123"}'
```

## Deploy en Vercel (Frontend)

1. Mantén `vercel.json` en la raíz del repo para servir `frontend/` y fallback SPA.
2. Publica el backend en Render/Railway/Fly (recomendado para FastAPI persistente).
3. En el backend define variables:
   - `JWT_SECRET` (obligatoria y fuerte)
   - `MONGO_URL`, `DB_NAME`
   - `CORS_ORIGINS` (incluye tu dominio principal)
   - `CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app` (para previews)
4. En frontend, define la API pública con:
   - `meta[name="finance-api-base"]` en `frontend/index.html`, o
   - abrir una vez `https://tu-app.vercel.app/?api=https://tu-backend.example.com`

## Comandos Útiles

### Backend

```bash
# Linting
flake8 app/
black app/
isort app/

# Type checking
mypy app/

# Format automatico
black app/ --line-length=100

# Logs
tail -f logs/finance_app.log
```

### Docker

```bash
# Build
docker build -t finance-api:latest backend/

# Compose
docker-compose up -d
docker-compose down
docker-compose logs -f api

# MongoDB
docker exec finance-mongo mongosh -u admin -p admin
```

## Debugging

### Backend Debugging

```python
# En cualquier función
import ipdb; ipdb.set_trace()

# Luego: n (next), s (step), c (continue), p variable_name
```

### Frontend Debugging

```javascript
// En DevTools
debugger;

// O en elemento
console.log('Info:', data);
console.error('Error:', error);
console.warn('Warning:', message);
```

### Ver logs

```bash
# Backend
docker-compose logs api -f

# MongoDB
docker-compose logs mongo -f

# Nginx
docker-compose logs nginx -f
```

## Performance

### Índices MongoDB

Los índices están configurados en `db.py` :

- users.email (único)
- transactions (user_id, date)
- budgets (user_id, month)

Para agregar más:

```python
async def create_indexes():
    await mi_coleccion().create_index([("field", ASCENDING)])
```

### Caché de Frontend

El Service Worker cachea activos estáticos. Limpiar:

```javascript
// En DevTools
navigator.serviceWorker.getRegistrations().then((reg) => {
  reg.forEach((r) => r.unregister());
});

// O borrar del navegador
```

## Mejores Prácticas

✅ **Hacer:**

- Usar `async/await` para operaciones I/O
- Validar entrada en el servidor
- Usar type hints
- Documentar funciones complejas
- Tests antes de commit
- Commits pequeños y descriptivos

❌ **Evitar:**

- Queries N+1
- Operaciones bloqueantes en async
- Secrets en código
- TODO comentarios sin resolver
- Archivos grandes

## Despliegue

Ver instrucciones en README.md y docker-compose.yml

## Troubleshooting

### Error: "ModuleNotFoundError: No module named 'app'"

```bash
# Asegúrate de estar en la carpeta correcta
cd backend
# O agregar al PYTHONPATH
export PYTHONPATH="${PYTHONPATH}:/path/to/finance_app"
```

### Error: "Connection refused" para MongoDB

```bash
# Verificar que MongoDB está corriendo
docker ps | grep mongo

# O iniciar MongoDB
docker run -d -p 27017:27017 mongo:7
```

### Frontend no carga datos

1. Verificar que API_URL en app.js es correcto
2. Revisar CORS en main.py
3. Ver Network tab en DevTools
4. Revisar console para errores

---

**Última actualización**: Marzo 2026
