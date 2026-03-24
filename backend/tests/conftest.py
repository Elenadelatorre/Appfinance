"""
Configuración de pytest para Finance App
"""

import sys
from pathlib import Path

# Agregar el backend al path para que pytest pueda importar los módulos
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))
