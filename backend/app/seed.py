"""Cria dados de exemplo para desenvolvimento.

Rodar: python -m app.seed
Login gestor:     gestor@frotagest.dev / gestor123
Login motoristas: CPF 11111111111, 22222222222, 33333333333 / motorista123
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal, init_db
from app.integrations.mock import ROUTES
from app.models import (
    Company,
    Conversation,
    ConversationKind,
    ConversationMember,
    Delivery,
    Message,
    TrackerProvider,
    User,
    UserRole,
    Vehicle,
)
from app.workers.poller import sync_company

# Entregas de exemplo saindo do CD de Contagem: cliente, endereço, cidade, NF, peso (kg), volumes
SAMPLE_DELIVERIES = [
    ("Supermercado Bom Preço", "Av. Selim José de Sales, 2100", "Ipatinga", "45.218", 820, 41),
    ("Drogaria Vida", "Rua Diamantina, 455", "Ipatinga", "45.219", 140, 12),
    ("Atacado Minas Sul", "Av. Renato Azeredo, 3300", "Sete Lagoas", "45.220", 1350, 60),
    ("Padaria Pão de Ouro", "Rua Paulo Frontin, 88", "Sete Lagoas", "45.221", 260, 18),
    ("Mercearia São José", "Rua Marechal Floriano, 912", "Governador Valadares", "45.222", 540, 27),
    ("Hortifruti Vale Verde", "Av. Minas Gerais, 1700", "Governador Valadares", "45.223", 710, 35),
    ("Empório Central", "Av. Amazonas, 5100", "Belo Horizonte", "45.224", 390, 20),
    ("Distribuidora Betim Norte", "Rua do Rosário, 230", "Betim", "45.225", 980, 44),
    ("Armazém do Bairro", "Av. João César de Oliveira, 1500", "Contagem", "45.226", 310, 16),
]


def seed_deliveries(db: Session, company_id: int, day: date) -> None:
    """Entregas do dia aguardando carregamento, para testar a tela de carregamento."""
    db.add_all(
        Delivery(
            company_id=company_id, scheduled_for=day, customer_name=customer, address=address, city=city,
            invoice_number=nf, weight_kg=weight, volumes=volumes,
        )
        for customer, address, city, nf, weight, volumes in SAMPLE_DELIVERIES
    )


def seed() -> None:
    init_db()
    with SessionLocal() as db:
        if db.scalar(select(Company).limit(1)):
            print("Banco já tem dados; nada a fazer. Apague o arquivo frotagest.db para recriar.")
            return

        # A base fica no ponto de onde o simulador sai e para onde volta
        base_lat, base_lon = ROUTES[0][0]
        company = Company(
            name="Transportadora Exemplo", cnpj="00.000.000/0001-00", tracker_credentials={},
            base_name="CD Contagem", base_address="Contagem - MG",
            base_latitude=base_lat, base_longitude=base_lon, base_radius_m=500,
        )
        db.add(company)
        db.flush()

        admin = User(
            company_id=company.id, name="Marina Costa", email="gestor@frotagest.dev",
            password_hash=hash_password("gestor123"), role=UserRole.admin,
        )
        drivers = [
            User(company_id=company.id, name=name, cpf=cpf, password_hash=hash_password("motorista123"), role=UserRole.driver)
            for name, cpf in [("João Pereira", "11111111111"), ("Carla Mendes", "22222222222"), ("Rafael Souza", "33333333333")]
        ]
        db.add(admin)
        db.add_all(drivers)
        db.flush()

        plates = ["RXY4B21", "QTE9A88", "HJK7D10"]
        db.add_all(
            Vehicle(
                company_id=company.id, plate=plate, model="VW Delivery 11.180", capacity_kg=6000,
                fuel_type="diesel", km_per_liter=5.5,
                tracker_provider=TrackerProvider.mock, tracker_external_id=f"MOCK-{plate}",
                current_driver_id=driver.id,
            )
            for plate, driver in zip(plates, drivers)
        )

        group = Conversation(company_id=company.id, kind=ConversationKind.group, name="Frota BH · todos")
        db.add(group)
        db.flush()
        db.add_all(ConversationMember(conversation_id=group.id, user_id=u.id) for u in [admin, *drivers])
        now = datetime.now(timezone.utc)
        db.add_all([
            Message(conversation_id=group.id, sender_id=admin.id, body="Bom dia, pessoal. Lembrem do checklist antes de sair do CD.", created_at=now - timedelta(hours=3)),
            Message(conversation_id=group.id, sender_id=drivers[2].id, body="Feito. Saindo agora para Valadares.", created_at=now - timedelta(hours=2, minutes=40)),
        ])

        direct = Conversation(company_id=company.id, kind=ConversationKind.direct)
        db.add(direct)
        db.flush()
        db.add_all([ConversationMember(conversation_id=direct.id, user_id=admin.id), ConversationMember(conversation_id=direct.id, user_id=drivers[0].id)])
        db.add(Message(conversation_id=direct.id, sender_id=drivers[0].id, body="Cheguei no cliente de Ipatinga.", created_at=now - timedelta(minutes=20)))
        seed_deliveries(db, company.id, datetime.now(ZoneInfo(get_settings().timezone)).date())
        db.commit()

        inserted = sync_company(db, company)
        print(f"Dados de exemplo criados ({inserted} posições simuladas).")


if __name__ == "__main__":
    seed()
