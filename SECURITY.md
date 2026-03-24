# 🔒 Guía de Seguridad - Finance App

## Contraseñas Fuertes Requeridas

Al registrarse, las contraseñas DEBEN cumplir:
- ✅ Mínimo 8 caracteres
- ✅ Al menos una MAYÚSCULA
- ✅ Al menos un NÚMERO

Ejemplo válido: `MiPassword123`

## Variables de Entorno Críticas

### 1. JWT_SECRET (⚠️ CRÍTICO)

**Desarrollo:**
```bash
JWT_SECRET=dev-key-change-in-production
```

**Producción:**
```bash
# Generar una clave segura de 32+ caracteres
# Linux/Mac:
openssl rand -hex 32

# O Python:
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. MONGO_INITDB_ROOT_PASSWORD

Cambiar de `changeme` a una contraseña fuerte:
```bash
MONGO_INITDB_ROOT_PASSWORD=Tu_Contraseña_Fuerte_2026!
```

### 3. CORS_ORIGINS

**Desarrollo:**
```bash
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

**Producción:**
```bash
CORS_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

**NUNCA usar:**
```bash
CORS_ORIGINS=*  # ❌ INSEGURO
```

## Mejores Prácticas

### 🔐 Base de Datos
- [ ] Usar MongoDB con autenticación habilitada
- [ ] Contraseña de admin fuerte (16+ caracteres)
- [ ] Encriptación en tránsito (TLS)
- [ ] Backups automáticos diarios
- [ ] Restauraciones regulares de prueba

### 🔑 API & Tokens
- [ ] JWT_SECRET mínimo 32 caracteres
- [ ] Tokens expiran cada 30 días
- [ ] Refrescar tokens en segundo plano
- [ ] Logout revoca el token del navegador
- [ ] No guardar tokens en localStorage (usar httpOnly cookies)

### 🌐 HTTPS/TLS
- [ ] Certificado SSL válido (Let's Encrypt)
- [ ] Redirección HTTP → HTTPS
- [ ] HSTS headers activado
- [ ] Certificados renovados antes de expirar

### 🛡️ Headers de Seguridad
```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Content-Security-Policy: restricto
Referrer-Policy: no-referrer-when-downgrade
```

### 📝 Validación
- [ ] Validar entrada en frontend Y backend
- [ ] Sanitizar datos antes de almacenar
- [ ] Limitar tamaño de payloads
- [ ] Validar tipos de dato

### 🚫 Nunca Hacer
- ❌ Guardar contraseñas en texto plano
- ❌ Usar `console.log()` con datos sensibles
- ❌ Enviar tokens en URLs
- ❌ Desactivar HTTPS en producción
- ❌ Usar secretos débiles
- ❌ Logging de contraseñas o tokens
- ❌ Allow cors origins = "*"

## Auditoría de Seguridad

### Testing Manual
```bash
# 1. Intentar login con credenciales inválidas
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=fake@test.com&password=wrong"

# 2. Acceder a endpoints sin token
curl http://localhost:8000/transactions

# 3. Usar token inválido
curl -H "Authorization: Bearer invalid-token" \
  http://localhost:8000/transactions

# 4. Fuerza bruta contra contraseña (debería limitar después de 5 intentos)
for i in {1..10}; do
  curl -X POST http://localhost:8000/auth/login \
    -d "username=user&password=wrongpass"
done
```

### Verificar Headers
```bash
curl -I http://localhost/

# Debe mostrar:
# X-Frame-Options: SAMEORIGIN
# X-Content-Type-Options: nosniff
# Etc...
```

### Monitoreo Continuado
- [ ] Logs de acceso y errores
- [ ] Alertas para múltiples fallos de login
- [ ] Monitoreo de carga (detectar ataques DDoS)
- [ ] Análisis de patrones de uso anómalo

## Checklist Pre-Producción

- [ ] JWT_SECRET es fuerte y único
- [ ] HTTPS está configurado y trabajando
- [ ] Base de datos tiene backups diarios
- [ ] CORS solo permite dominios autorizados
- [ ] Rate limiting está activo
- [ ] Logs están siendo almacenados y monitoreados
- [ ] Certificados SSL tienen renovación automática
- [ ] Contraseñas admin de BD son fuertes
- [ ] No hay secretos en .git o commits
- [ ] Tests de seguridad pasados (OWASP Top 10)

## Incidente - Si tu JWT_SECRET fue comprometido

1. **Inmediatamente:**
   - Generar nuovo JWT_SECRET
   - Actualizar en todas las instancias
   - Reiniciar servicio API

2. **Seguimiento:**
   - Revisar logs de acceso
   - Invalidar todos los tokens existentes
   - Notificar a usuarios

## Recursos Útiles

- [OWASP Top 10](https://owasp.org/Top10/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)
- [MongoDB Security](https://docs.mongodb.com/manual/security/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)

---

**Última actualización**: Marzo 2026
