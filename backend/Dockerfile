# Stage 1: Builder
FROM python:3.12.9-slim-bookworm AS builder
WORKDIR /app

# Instalar dependencias de compilación
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc && \
    rm -rf /var/lib/apt/lists/*

# Copiar requirements e instalar paquetes
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime
FROM python:3.12.9-slim-bookworm
WORKDIR /app

# Crear usuario no-root por seguridad
RUN useradd -m -u 1000 appuser

# Copiar archivos de usuario desde builder
COPY --from=builder /root/.local /home/appuser/.local
ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Copiar código de la aplicación
COPY app ./app

# Establecer permisos correctos
RUN chown -R appuser:appuser /app

# Cambiar al usuario no-root
USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/').read()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]# Rebuild trigger
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
