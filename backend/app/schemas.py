from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List

# --- CATEGORÍAS ---


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    icon: str = Field(default="help_outline", max_length=50)
    color: str = Field(
        default="#9e9e9e", pattern="^#[0-9A-Fa-f]{6}$"
    )  # Validar formato hex
    section_id: str
    parent_id: Optional[str] = None


class CategoryResponse(BaseModel):
    id: str
    name: str
    icon: str
    color: str
    section_id: str
    parent_id: Optional[str] = None
    # Esta línea permite que la categoría contenga a sus hijos
    subcategories: List["CategoryResponse"] = []

    # Esto permite que Pydantic lea diccionarios de MongoDB fácilmente
    model_config = ConfigDict(from_attributes=True)


# Muy importante: Esto "reconstruye" el modelo para que la
# autorreferencia de subcategories funcione sin errores.
CategoryResponse.model_rebuild()

# --- SECCIONES ---


class SectionResponse(BaseModel):
    section: str
    section_id: str
    categories: List[CategoryResponse]
