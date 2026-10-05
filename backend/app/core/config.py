from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "FrotaGest API"
    database_url: str = "sqlite:///./frotagest.db"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    cors_origins: str = "http://localhost:5173"
    speed_limit_kmh: float = 80.0
    # Fuso usado para agrupar as rotas por dia
    timezone: str = "America/Sao_Paulo"
    poll_interval_seconds: int = 60
    # Webservice da Sascar (troque pelo de homologação, se a Sascar fornecer um)
    sascar_url: str = "https://sasintegra.sascar.com.br/SasIntegra/SasIntegraWSService"
    # Fotos dos comprovantes de entrega
    upload_dir: str = "./uploads"
    max_photo_mb: int = 8
    # Notificações com o app fechado (Web Push): a chave VAPID é criada sozinha neste arquivo na primeira vez
    vapid_key_file: str = "./vapid_private.pem"
    # Chave VAPID em PEM, para servidores sem disco persistente (no lugar do arquivo acima)
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:suporte@frotagest.dev"
    # Opções de desenvolvedor (rastreador simulado). Desligue em produção: DEV_TOOLS=false
    dev_tools: bool = True
    # De quantos em quantos segundos o rastreador simulado anda (0 desliga o laço, como nos testes)
    simulator_tick_seconds: float = 2.0
    # Pasta com o build do frontend (npm run build). Vazia: a API não serve o painel
    static_dir: str = ""
    # Roda a coleta dos rastreadores dentro da API, para hospedagens sem worker separado
    run_poller: bool = False
    # Cria os dados de exemplo ao subir, se o banco estiver vazio
    seed_on_start: bool = False

    @field_validator("database_url")
    @classmethod
    def use_psycopg(cls, v: str) -> str:
        # Render, Heroku e Neon entregam postgres:// ou postgresql://; o driver instalado é o psycopg 3
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
