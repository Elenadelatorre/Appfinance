# 🤝 Contribución a Finance App

¡Gracias por tu interés en contribuir! Aquí se explica cómo puedes ayudar.

## Tipos de Contribución

### 🐛 Reportar Bugs
1. Abre un **Issue** describiendo el problema
2. Incluye:
   - Versión del sistema operativo
   - Pasos para reproducir
   - Resultado esperado vs. actual
   - Logs (si aplica)

### 💡 Sugerir Mejoras
1. Describe clara y concisamente la mejora propuesta
2. Explica por qué sería beneficiosa
3. Ejemplos de cómo funcionaría

### 📝 Mejorar Documentación
1. Clarificar instrucciones confusas
2. Agregar ejemplos
3. Corregir errores ortográficos
4. Traducir a otros idiomas

### 💻 Contribuir Código

## Flujo de Desarrollo

### 1. Fork y Clonar
```bash
git clone https://github.com/tu-usuario/finance-app.git
cd finance_app
```

### 2. Crear Rama
```bash
# Usar nombre descriptivo
git checkout -b feature/agregar-exportar-datos
# o
git checkout -b fix/corregir-calculo-intereses
```

### 3. Configurar Entorno
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # o .venv\Scripts\activate en Windows
pip install -r requirements-dev.txt
```

### 4. Hacer Cambios
```bash
# Editar código
# Escribir/actualizar tests
# Verificar que todo funciona

# Format de código
black app/
isort app/

# Linting
flake8 app/
mypy app/

# Tests
pytest tests/ -v --cov=app
```

### 5. Commit
```bash
# Mensajes claros y descriptivos
git commit -m "feat: agregar exportación de datos a CSV"
git commit -m "fix: corregir cálculo de presupuesto mensual"
git commit -m "docs: mejorar instrucciones de instalación"

# Tipos de commit:
# feat:     nueva funcionalidad
# fix:      corrección de bug
# docs:     cambios en documentación
# style:    formato, sin cambios lógicos
# refactor: refactorización
# test:     agregar/actualizar tests
# chore:    dependencias, configuración
```

### 6. Push y Pull Request
```bash
git push origin feature/agregar-exportar-datos
```

Luego crear Pull Request en GitHub

## Estándares de Código

### Python
```python
# ✅ Bueno
def calculate_monthly_expense(transactions: list[Transaction], month: int) -> float:
    """Calcular gastos totales del mes.
    
    Args:
        transactions: Lista de transacciones
        month: Número de mes (1-12)
    
    Returns:
        Total gastos en formato float
    """
    return sum(t.amount for t in transactions if t.month == month and t.type == "expense")

# ❌ Evitar
def calc(txs, m):
    return sum(x.amount for x in txs if x.month == m and x.type == "expense")
```

### JavaScript
```javascript
// ✅ Bueno
async function fetchUserTransactions(userId) {
  try {
    const response = await api(`/users/${userId}/transactions`);
    return response;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    showAlert('Error cargando transacciones', 'error');
    throw error;
  }
}

// ❌ Evitar
async function getTxs(id) {
  return fetch(`/users/${id}/transactions`).then(r => r.json());
}
```

### Documentación
- Docstrings en todas las funciones públicas
- Type hints en Python
- Comentarios solo para lógica compleja
- README actualizado si hay cambios mayores

## Proceso de Revisión

1. Verifican que el código cumple estándares
2. Ejecutan tests automáticos
3. Revisan logística y seguridad
4. Piden cambios si es necesario
5. Aprueban y mergean

## Licencia

Al contribuir, aceptas que tu código será bajo licencia MIT.

## Código de Conducta

- Sé respetuoso con otros contribuyentes
- Acepta feedback constructivo
- Reporta comportamiento inapropiado

---

¡Gracias por contribuir a make Finance App mejor! 🚀
