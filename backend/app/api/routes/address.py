from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser
from app.schemas.address import CitySuggestion, StreetSuggestion
from app.services import address

router = APIRouter(prefix="/address", tags=["endereços"])

UNAVAILABLE = "Não consegui buscar sugestões agora. Digite o endereço normalmente."


@router.get("/cities", response_model=list[CitySuggestion])
def suggest_cities(_: CurrentUser, q: str = Query(min_length=2, max_length=80)):
    """Cidades (lista de municípios do IBGE) que batem com o texto digitado, com a UF."""
    try:
        return address.search_cities(q)
    except address.AddressLookupError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, UNAVAILABLE)


@router.get("/streets", response_model=list[StreetSuggestion])
def suggest_streets(
    _: CurrentUser,
    q: str = Query(min_length=3, max_length=120, description="Nome da rua (o número é ignorado) ou CEP"),
    city: str | None = Query(default=None, max_length=120),
    uf: str | None = Query(default=None, pattern=r"^[A-Za-z]{2}$", description="Sem UF, vale a da cidade se o nome for único"),
):
    """Ruas da cidade pelo ViaCEP. Com um CEP no lugar do nome, devolve o endereço desse CEP (a cidade não é necessária)."""
    try:
        return address.search_streets(q, city, uf)
    except address.AddressLookupError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, UNAVAILABLE)
