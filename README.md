# 💰 Finance App - Sistema de Gestión Financiera Personal

Una aplicación moderna de gestión financiera personal con interfaz web progresiva y API REST robusta.

## ✨ Características

- 📊 **Dashboard completo** - Vista consolidada de ingresos, gastos y presupuestos
- 💳 **Múltiples cuentas** - Gestiona efectivo, cuentas bancarias y tarjetas de crédito
- 📈 **Análisis avanzado** - Resúmenes mensuales y desglose por categorías
- 🎯 **Presupuestos** - Establece límites y recibe alertas de gastos excesivos
- 👤 **Autenticación JWT** - Segura y escalable
- 📱 **PWA** - Funciona sin conexión y como aplicación nativa
- 🎨 **Interfaz moderna** - Diseño responsive y atractivo
- 🚀 **API RESTful** - Documentación interactiva en `/docs`

## 🛠️ Tech Stack

### Backend

- **FastAPI** - Framework moderno y rápido
- **MongoDB** - Base de datos NoSQL flexible
- **Motor** - Driver async para MongoDB
- **PyJWT** - Autenticación segura
- **Pydantic** - Validación de datos

### Frontend

- **HTML5/CSS3** - Interfaz moderna
- **JavaScript Vanilla** - Sin dependencias pesadas
- **Service Worker** - Funcionamiento offline
- **IndexedDB** - Almacenamiento local

### DevOps

- **Docker & Docker Compose** - Contenedores
- **Nginx** - Proxy inverso y servidor estático
- **Health Checks** - Monitoreo automático

## 🚀 Inicio Rápido

### Requisitos

- Docker y Docker Compose
- O bien: Python 3.12+, Node.js (para desarrollo local)

### Con Docker (Recomendado)

```bash
# 1. Clonar y entrar al directorio
cd finance_app

# 2. Copiar configuración
cp .env.example .env

# 3. Personalizar variables (importante JWT_SECRET)
nano .env

# 4. Iniciar los servicios
docker-compose up -d

# 5. Acceder a la aplicación
# Frontend: http://localhost:80
# API Docs: http://localhost:8000/docs
# API Root: http://localhost:8000/
```

### Desarrollo Local

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
export JWT_SECRET="dev-key-change-in-production"
export MONGO_URL="mongodb://localhost:27017"
uvicorn app.main:app --reload

# Frontend
# Abrir frontend/index.html en un navegador
# Cambiar API_URL en app.js a http://localhost:8000
```

## 📚 API Endpoints

### Autenticación

- `POST /auth/register` - Crear cuenta
- `POST /auth/login` - Iniciar sesión
- `GET /me` - Datos del usuario actual

### Cuentas

- `GET /accounts` - Listar cuentas
- `POST /accounts` - Crear cuenta
- `GET /accounts/{id}` - Obtener cuenta
- `DELETE /accounts/{id}` - Eliminar cuenta

### Transacciones

- `GET /transactions` - Listar transacciones
- `POST /transactions` - Crear transacción
- `POST /transactions/{id}` - Actualizar transacción
- `DELETE /transactions/{id}` - Eliminar transacción

### Análisis

- `GET /dashboard` - Dashboard completo
- `GET /summary/monthly` - Resumen mensual
- `GET /accounts/balances` - Saldos de todas las cuentas

Ver documentación completa en `/docs` cuando la API esté corriendo.

## 🔒 Seguridad

### ✅ Implementado

- JWT con expiración configurable
- Hash de contraseñas con bcrypt
- CORS personalizado (no allow_origins="\*")
- Validación de entrada con Pydantic
- HTTPOnly cookies (próximamente)
- Logging de eventos

### ⚠️ Para Producción

1. **Cambiar JWT_SECRET** a un valor largo y seguro (mín 32 caracteres)
2. **HTTPS obligatorio** - Usar certificados SSL/TLS
3. **Base de datos segura** - MongoDB con autenticación y encriptación
4. **Rate limiting** - Implementar en Nginx o FastAPI
5. **CORS específico** - Solo dominios autorizados
6. **Monitoreo** - Logs centralizados y alertas
7. **Backups** - Estrategia de respaldo de base de datos

## 📖 Estructura del Proyecto

```
finance_app/
├── backend/
│   ├── app/
│   │   ├── main.py           # Configuración FastAPI
│   │   ├── auth.py           # JWT y contraseñas
│   │   ├── routes.py         # Endpoints
│   │   ├── models.py         # Modelos Pydantic
│   │   ├── schemas.py        # Esquemas respuesta
│   │   ├── db.py             # Conexión MongoDB
│   │   └── logic.py          # Lógica de negocio
│   ├── requirements.txt
│   └── Dockerfile            # Multi-stage build
├── frontend/
│   ├── index.html
│   ├── app.js               # Lógica JS
│   ├── style.css
│   ├── sw.js               # Service Worker
│   └── manifest.webmanifest # PWA config
├── docker-compose.yml
├── nginx.conf
├── .env.example
└── README.md
```

## 🐛 Troubleshooting

### MongoDB no conecta

```bash
# Verificar que el contenedor está corriendo
docker-compose ps

# Ver logs de MongoDB
docker-compose logs mongo

# Configurar correctamente MONGO_URL en .env
MONGO_URL=mongodb://admin:changeme@mongo:27017/?authSource=admin
```

### API retorna 401

- Verificar que token está siendo enviado en header: `Authorization: Bearer <token>`
- Chequear que JWT_SECRET coincide entre generación y validación
- Token puede haber expirado (default 30 días)

### Frontend no carga datos

- Verificar CORS_ORIGINS en backend
- Chequear Network tab en DevTools
- Confirmar que API está corriendo: `curl http://localhost:8000/`

## 📝 Configuración Avanzada

### Variables de Entorno

```env
# Base de datos
MONGO_URL                      # URL de conexión
DB_NAME=finance               # Nombre de BD
MONGO_INITDB_ROOT_USERNAME    # Usuario admin
MONGO_INITDB_ROOT_PASSWORD    # Contraseña admin

# Seguridad
JWT_SECRET                    # Clave secreta (CAMBIAR EN PRODUCCIÓN)
ACCESS_TOKEN_EXPIRE_DAYS=30   # Expiración de sesión

# CORS
CORS_ORIGINS                  # Dominios permitidos (separados por coma)

# Logging
LOG_LEVEL=INFO               # DEBUG, INFO, WARNING, ERROR
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crear rama para feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver archivo `LICENSE` para más detalles.

## 📧 Contacto

¿Preguntas o sugerencias? Abre un issue en el repositorio.

---

**Última actualización**: Marzo 2026
**Versión**: 1.0.0
