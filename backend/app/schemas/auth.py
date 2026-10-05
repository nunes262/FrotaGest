from pydantic import BaseModel

from app.models import UserRole


class LoginRequest(BaseModel):
    # E-mail (gestor) ou CPF (motorista)
    login: str
    password: str


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    company_id: int
    name: str
    email: str | None
    cpf: str | None
    role: UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
