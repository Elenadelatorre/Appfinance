"""
Tests básicos para Finance App API
Ejecutar con: pytest tests/ -v
"""

import asyncio
from datetime import datetime
from bson import ObjectId

import pytest
import app.models as models
from fastapi.testclient import TestClient
from app.main import app
from app.auth import create_access_token
from app.logic import (
    get_billing_cycle_bounds,
    get_billing_cycle_period,
    get_summary_for_period,
    seed_categories_for_user,
)

client = TestClient(app)

PASSWORD_FIELD = "password"
CURRENT_PASSWORD_FIELD = "current_password"
NEW_PASSWORD_FIELD = "new_password"


class TestAuth:
    """Tests para autenticación"""

    @staticmethod
    def _patch_register_dependencies(monkeypatch, *, existing_user=None):
        import app.routes as routes

        class _FakeInsertResult:
            inserted_id = ObjectId()

        class _FakeUsersCol:
            async def find_one(self, query):
                await asyncio.sleep(0)
                if existing_user and query.get("email") == existing_user.get("email"):
                    return existing_user
                return None

            async def insert_one(self, _doc):
                await asyncio.sleep(0)
                return _FakeInsertResult()

        monkeypatch.setattr(routes, "users_col", lambda: _FakeUsersCol())
        monkeypatch.setattr(
            routes, "seed_categories_for_user", lambda _user_id: asyncio.sleep(0)
        )

    def test_register_valid(self, monkeypatch):
        """Registro exitoso"""
        self._patch_register_dependencies(monkeypatch)
        response = client.post(
            "/auth/register",
            json={
                "email": f"test_{id(self)}@example.com",
                PASSWORD_FIELD: "StrongPass123",
            },
        )
        assert response.status_code in [200, 201]
        assert "access_token" in response.json()

    def test_register_weak_password(self, monkeypatch):
        """Rechaza contraseña demasiado corta"""
        self._patch_register_dependencies(monkeypatch)
        response = client.post(
            "/auth/register",
            json={
                "email": f"test_{id(self)}@example.com",
                PASSWORD_FIELD: "12345",
            },
        )
        assert response.status_code == 422

    def test_register_no_number_password(self, monkeypatch):
        """Acepta contraseña sin números cuando cumple longitud mínima"""
        self._patch_register_dependencies(monkeypatch)
        response = client.post(
            "/auth/register",
            json={
                "email": f"test_{id(self)}@example.com",
                PASSWORD_FIELD: "WeakPass",
            },
        )
        assert response.status_code in [200, 201]
        assert "access_token" in response.json()

    def test_register_invalid_email(self):
        """Rechaza email inválido"""
        response = client.post(
            "/auth/register",
            json={"email": "not-an-email", PASSWORD_FIELD: "StrongPass123"},
        )
        assert response.status_code == 422

    def test_login_invalid_credentials(self, monkeypatch):
        """Login con credenciales inválidas"""
        # Evita dependencia de MongoDB real durante este test.
        import app.routes as routes

        class _FakeUsersCol:
            async def find_one(self, _query):
                await asyncio.sleep(0)
                return None

        monkeypatch.setattr(routes, "users_col", lambda: _FakeUsersCol())

        response = client.post(
            "/auth/login",
            data={"username": "nonexistent@example.com", PASSWORD_FIELD: "wrong"},
        )
        assert response.status_code == 401

    def test_change_password_success(self, monkeypatch):
        """Cambio de contraseña exitoso para usuario autenticado"""
        import app.routes as routes
        from app.auth import hash_password, verify_password

        user_oid = ObjectId()
        old_secret = "StrongPass123"
        new_secret = "NuevaPass456"

        class _FakeUpdateResult:
            modified_count = 1

        class _FakeUsersCol:
            def __init__(self):
                self.user = {
                    "_id": user_oid,
                    "email": "user@example.com",
                    PASSWORD_FIELD: hash_password(old_secret),
                }

            async def find_one(self, query, *_args):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    return self.user
                return None

            async def update_one(self, query, update):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    self.user[PASSWORD_FIELD] = update["$set"][PASSWORD_FIELD]
                return _FakeUpdateResult()

        fake_col = _FakeUsersCol()
        monkeypatch.setattr(routes, "users_col", lambda: fake_col)

        token = create_access_token(str(user_oid))
        response = client.post(
            "/auth/change-password",
            json={
                CURRENT_PASSWORD_FIELD: old_secret,
                NEW_PASSWORD_FIELD: new_secret,
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json().get("status") == "success"
        assert verify_password(new_secret, fake_col.user[PASSWORD_FIELD])

    def test_change_password_rejects_wrong_current_password(self, monkeypatch):
        """Rechaza cambio de contraseña si la actual no coincide"""
        import app.routes as routes
        from app.auth import hash_password

        user_oid = ObjectId()

        class _FakeUsersCol:
            async def find_one(self, query, *_args):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    return {
                        "_id": user_oid,
                        "email": "user@example.com",
                        PASSWORD_FIELD: hash_password("StrongPass123"),
                    }
                return None

            async def update_one(self, _query, _update):
                await asyncio.sleep(0)
                return None

        monkeypatch.setattr(routes, "users_col", lambda: _FakeUsersCol())

        token = create_access_token(str(user_oid))
        response = client.post(
            "/auth/change-password",
            json={
                CURRENT_PASSWORD_FIELD: "Incorrecta123",
                NEW_PASSWORD_FIELD: "NuevaPass456",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400


class TestAPI:
    """Tests para endpoints de la API"""

    @pytest.fixture
    def auth_token(self):
        """Crear token de autenticación para tests"""
        token = create_access_token("test_user_id")
        return f"Bearer {token}"

    def test_root_endpoint(self):
        """Endpoint raíz debe responder OK"""
        response = client.get("/")
        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_me_without_token(self):
        """Acceso a /me sin token debe fallar"""
        response = client.get("/me")
        assert response.status_code == 401

    def test_invalid_token(self):
        """Token inválido debe ser rechazado"""
        response = client.get("/me", headers={"Authorization": "Bearer invalid_token"})
        assert response.status_code == 401

    def test_root_has_version(self, auth_token):
        """Verificar que root endpoint tiene versión"""
        response = client.get("/")
        data = response.json()
        assert "version" in data

    def test_get_me_settings_returns_defaults(self, monkeypatch):
        import app.routes as routes

        user_oid = ObjectId()

        class _FakeUsersCol:
            async def find_one(self, query, *_args):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    return {"_id": user_oid, "settings": {}}
                return None

        monkeypatch.setattr(routes, "users_col", lambda: _FakeUsersCol())

        token = create_access_token(str(user_oid))
        response = client.get(
            "/me/settings",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "default_view": "home",
            "reduce_motion": False,
            "profile_avatar": "auto",
            "accent_color": "#6366f1",
        }

    def test_update_me_settings_persists_changes(self, monkeypatch):
        import app.routes as routes

        user_oid = ObjectId()

        class _FakeUsersCol:
            def __init__(self):
                self.user = {
                    "_id": user_oid,
                    "settings": {
                        "default_view": "home",
                        "reduce_motion": False,
                        "profile_avatar": "auto",
                    },
                }

            async def find_one(self, query, *_args):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    return self.user
                return None

            async def update_one(self, query, update):
                await asyncio.sleep(0)
                if query.get("_id") == user_oid:
                    self.user["settings"] = update["$set"]["settings"]

        fake_col = _FakeUsersCol()
        monkeypatch.setattr(routes, "users_col", lambda: fake_col)

        token = create_access_token(str(user_oid))
        response = client.put(
            "/me/settings",
            json={
                "default_view": "accounts",
                "reduce_motion": True,
                "profile_avatar": "😎",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "default_view": "accounts",
            "reduce_motion": True,
            "profile_avatar": "😎",
            "accent_color": "#6366f1",
        }
        assert fake_col.user["settings"]["default_view"] == "accounts"

    def test_update_category_cannot_touch_other_user_data(self, monkeypatch):
        import app.routes as routes

        category_oid = ObjectId()

        class _FakeCategoriesCol:
            async def find_one(self, query, *_args, **_kwargs):
                await asyncio.sleep(0)
                category = {
                    "_id": category_oid,
                    "user_id": "user-b",
                    "name": "Privada",
                    "section_id": "sec-1",
                    "parent_id": None,
                }
                if (
                    query.get("_id") == category_oid
                    and query.get("user_id") == "user-b"
                ):
                    return category
                return None

            async def update_one(self, *_args, **_kwargs):
                await asyncio.sleep(0)
                raise AssertionError(
                    "No debería intentar actualizar una categoría ajena"
                )

        monkeypatch.setattr(routes, "categories_col", lambda: _FakeCategoriesCol())
        monkeypatch.setattr(
            routes, "seed_categories_for_user", lambda _user_id: asyncio.sleep(0)
        )

        token = create_access_token("user-a")
        response = client.patch(
            f"/categories/{category_oid}",
            json={"name": "Cambio"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 404


class TestCategoryIsolation:
    def test_seed_categories_for_user_clones_global_defaults(self, monkeypatch):
        import app.logic as logic

        parent_oid = ObjectId()
        child_oid = ObjectId()
        inserted_docs = []
        docs = [
            {
                "_id": parent_oid,
                "name": "Hogar",
                "section_id": "sec-gastos",
                "icon": "🏠",
                "color": "#f97316",
                "parent_id": None,
                "order": 2,
            },
            {
                "_id": child_oid,
                "name": "Alquiler",
                "section_id": "sec-gastos",
                "icon": "🏠",
                "color": "#f97316",
                "parent_id": str(parent_oid),
                "order": 0,
            },
        ]

        def _matches(doc, query):
            if not query:
                return True
            if "$or" in query:
                return any(_matches(doc, item) for item in query["$or"])
            for key, value in query.items():
                if isinstance(value, dict) and "$exists" in value:
                    exists = key in doc
                    if exists != value["$exists"]:
                        return False
                    continue
                if doc.get(key) != value:
                    return False
            return True

        class _FakeCursor:
            def __init__(self, items):
                self.items = items

            async def to_list(self, length=None):
                await asyncio.sleep(0)
                if length is None:
                    return list(self.items)
                return list(self.items)[:length]

        class _FakeInsertResult:
            def __init__(self, inserted_id):
                self.inserted_id = inserted_id

        class _FakeCategoriesCol:
            async def find_one(self, query, *_args, **_kwargs):
                await asyncio.sleep(0)
                for doc in docs + inserted_docs:
                    if _matches(doc, query):
                        return doc
                return None

            def find(self, query):
                matches = [doc for doc in docs + inserted_docs if _matches(doc, query)]
                return _FakeCursor(matches)

            async def insert_one(self, doc):
                await asyncio.sleep(0)
                stored = dict(doc)
                stored["_id"] = ObjectId()
                inserted_docs.append(stored)
                return _FakeInsertResult(stored["_id"])

        monkeypatch.setattr(logic, "categories_col", lambda: _FakeCategoriesCol())
        monkeypatch.setattr(logic, "seed_initial_categories", lambda: asyncio.sleep(0))

        asyncio.run(seed_categories_for_user("user-1"))

        assert len(inserted_docs) == 2
        assert all(doc["user_id"] == "user-1" for doc in inserted_docs)

        cloned_parent = next(doc for doc in inserted_docs if doc["parent_id"] is None)
        cloned_child = next(
            doc for doc in inserted_docs if doc["parent_id"] is not None
        )
        assert cloned_parent["name"] == "Hogar"
        assert cloned_child["name"] == "Alquiler"
        assert cloned_child["parent_id"] == str(cloned_parent["_id"])


class TestValidation:
    """Tests para validación de datos"""

    def test_transaction_negative_amount(self):
        """No permitir transacciones con monto negativo"""
        token = create_access_token("test_user")
        response = client.post(
            "/transactions",
            json={
                "amount": -100,  # Negativo no permitido
                "type": "expense",
                "category_id": "test",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        # Debería fallar validación
        assert response.status_code in [422, 400]

    def test_budget_invalid_month(self):
        """No permitir mes inválido"""
        token = create_access_token("test_user")
        response = client.post(
            "/budgets",
            json={
                "category_id": "test",
                "limit_amount": 500,
                "month": 13,  # Mes inválido
                "year": 2025,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code in [422, 400]

    def test_transfer_creates_paired_transactions(self, monkeypatch):
        """Una transferencia debe generar un gasto y un ingreso enlazados por concepto."""
        import app.routes as routes

        source_id = ObjectId()
        destination_id = ObjectId()
        inserted_docs = []

        class _FakeInsertResult:
            def __init__(self):
                self.inserted_id = ObjectId()

        class _FakeAccountsCol:
            async def find_one(self, query, *_args, **_kwargs):
                await asyncio.sleep(0)
                if query.get("_id") == source_id:
                    return {"_id": source_id, "user_id": "test_user", "name": "Origen"}
                if query.get("_id") == destination_id:
                    return {
                        "_id": destination_id,
                        "user_id": "test_user",
                        "name": "Destino",
                    }
                return None

        class _FakeTxCol:
            async def insert_one(self, doc):
                await asyncio.sleep(0)
                inserted_docs.append(doc)
                return _FakeInsertResult()

        monkeypatch.setattr(routes, "accounts_col", lambda: _FakeAccountsCol())
        monkeypatch.setattr(routes, "tx_col", lambda: _FakeTxCol())

        token = create_access_token("test_user")
        response = client.post(
            "/transfers",
            json={
                "source_account_id": str(source_id),
                "destination_account_id": str(destination_id),
                "amount": 125.5,
                "description": "Mover saldo",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(inserted_docs) == 2
        assert inserted_docs[0]["type"] == "expense"
        assert inserted_docs[0]["category_id"] == "transfer_out"
        assert inserted_docs[1]["type"] == "income"
        assert inserted_docs[1]["category_id"] == "transfer_in"


class TestSecurity:
    """Tests para seguridad"""

    def test_cors_headers(self):
        """Verificar que CORS está configurado"""
        response = client.get("/")
        # Verificar que no hay allow_origins="*"
        if "access-control-allow-origin" in response.headers:
            allowed = response.headers.get("access-control-allow-origin", "")
            assert allowed != "*", "CORS no debería ser *"

    def test_password_hashing(self):
        """Las contraseñas nunca deben ser devueltas en texto plano"""
        from app.auth import hash_password

        password = "MyPassword123"
        hashed = hash_password(password)
        assert hashed != password
        assert len(hashed) > len(password)


class TestBillingCycle:
    """Tests para el ciclo mensual personalizado."""

    def test_billing_cycle_uses_previous_month_before_day_26(self):
        start, end = get_billing_cycle_bounds(datetime(2026, 3, 21, 10, 0, 0))

        assert start == datetime(2026, 2, 26)
        assert end == datetime(2026, 3, 26)

    def test_billing_cycle_rolls_over_on_day_26(self):
        start, end = get_billing_cycle_bounds(datetime(2026, 3, 26, 8, 30, 0))

        assert start == datetime(2026, 3, 26)
        assert end == datetime(2026, 4, 26)

    def test_billing_cycle_period_uses_cycle_start_month_and_year(self):
        month, year = get_billing_cycle_period(datetime(2026, 1, 10, 9, 0, 0))

        assert month == 12
        assert year == 2025

    def test_budget_defaults_follow_billing_cycle(self, monkeypatch):
        monkeypatch.setattr(models, "get_billing_cycle_period", lambda: (2, 2026))

        budget = models.BudgetCreate(category_id="hogar", limit_amount=500)

        assert budget.month == 2
        assert budget.year == 2026

    def test_summary_for_period_uses_custom_date_range(self, monkeypatch):
        import app.logic as logic

        docs = [
            {
                "user_id": "user-1",
                "date": datetime(2026, 4, 1, 8, 0, 0),
                "type": "expense",
                "amount": 40,
                "category_id": "food",
            },
            {
                "user_id": "user-1",
                "date": datetime(2026, 4, 12, 9, 0, 0),
                "type": "income",
                "amount": 300,
                "category_id": "salary",
            },
            {
                "user_id": "user-1",
                "date": datetime(2026, 4, 30, 21, 0, 0),
                "type": "expense",
                "amount": 60,
                "category_id": "transport",
            },
            {
                "user_id": "user-1",
                "date": datetime(2026, 4, 18, 10, 0, 0),
                "type": "expense",
                "amount": 500,
                "category_id": "transfer_out",
            },
            {
                "user_id": "user-1",
                "date": datetime(2026, 5, 1, 8, 0, 0),
                "type": "expense",
                "amount": 999,
                "category_id": "other",
            },
        ]

        class _FakeCursor:
            def __init__(self, items):
                self.items = items

            async def to_list(self, length=None):
                await asyncio.sleep(0)
                return list(self.items)

        class _FakeTxCol:
            def find(self, query):
                date_query = query.get("date", {})
                allowed_categories = set(query.get("category_id", {}).get("$nin", []))
                items = []
                for doc in docs:
                    if doc.get("user_id") != query.get("user_id"):
                        continue
                    if doc.get("category_id") in allowed_categories:
                        continue
                    doc_date = doc.get("date")
                    if doc_date < date_query.get("$gte") or doc_date >= date_query.get(
                        "$lt"
                    ):
                        continue
                    items.append(doc)
                return _FakeCursor(items)

        monkeypatch.setattr(logic, "tx_col", lambda: _FakeTxCol())

        summary = asyncio.run(
            get_summary_for_period(
                datetime(2026, 4, 1), datetime(2026, 5, 1), user_id="user-1"
            )
        )

        assert summary["total_income"] == 300
        assert summary["total_expense"] == 100
        assert summary["balance"] == 200
        assert summary["category_breakdown"] == {"food": 40, "transport": 60}
        assert summary["period_start"].startswith("2026-04-01")
        assert summary["period_end"].startswith("2026-04-30")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
