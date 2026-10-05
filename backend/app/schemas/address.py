from pydantic import BaseModel


class CitySuggestion(BaseModel):
    name: str
    uf: str


class StreetSuggestion(BaseModel):
    # Vem vazio no CEP geral de cidades pequenas, que não têm CEP por rua
    street: str
    district: str
    city: str
    uf: str
    cep: str
