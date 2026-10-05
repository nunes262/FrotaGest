from pydantic import BaseModel, Field


class BaseLocation(BaseModel):
    """Base (CD) da empresa. Dentro do raio o caminhão conta como "na base"."""

    name: str = Field(min_length=2, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_m: int = Field(default=300, ge=50, le=5000)


class GeocodeResult(BaseModel):
    label: str
    latitude: float
    longitude: float
