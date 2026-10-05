"""Ajuste de esquema sem migrações: cria, em tabelas que já existem, as colunas novas dos modelos.

Enquanto o projeto não adota o Alembic, isso evita apagar o banco quando um modelo ganha um campo.
Só funciona para colunas que aceitam nulo (as linhas antigas ficam com o campo vazio).
"""

import logging

from sqlalchemy import Engine, inspect, text

from app.db.base import Base

log = logging.getLogger(__name__)


def add_missing_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    quote = engine.dialect.identifier_preparer.quote
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue  # tabela nova: o create_all cria inteira
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                if not column.nullable:
                    raise RuntimeError(
                        f"A coluna nova {table.name}.{column.name} precisa aceitar nulo para ser criada sem migração."
                    )
                ddl_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f"ALTER TABLE {quote(table.name)} ADD COLUMN {quote(column.name)} {ddl_type}"))
                log.info("Coluna criada: %s.%s", table.name, column.name)

    # Banco novo: o create_all cria o tipo já com todos os valores
    if engine.dialect.name == "postgresql" and inspector.has_table("deliveries"):
        # No Postgres o status da entrega é um tipo ENUM: o valor novo precisa ser criado fora de transação
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("ALTER TYPE deliverystatus ADD VALUE IF NOT EXISTS 'failed'"))


def backfill_run_loads(engine: Engine) -> None:
    """Rotas criadas antes de o peso ser guardado nelas: liga as entregas do dia (já carregadas) à rota mais recente
    do motorista naquele dia e soma o peso. Só mexe nas rotas sem peso, então roda uma vez."""
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE deliveries SET run_id = (
                SELECT r.id FROM delivery_runs r
                WHERE r.driver_id = deliveries.driver_id AND r.day = deliveries.scheduled_for AND r.load_kg IS NULL
                ORDER BY r.started_at DESC LIMIT 1
            )
            WHERE run_id IS NULL AND driver_id IS NOT NULL AND status <> 'pending' AND EXISTS (
                SELECT 1 FROM delivery_runs r
                WHERE r.driver_id = deliveries.driver_id AND r.day = deliveries.scheduled_for AND r.load_kg IS NULL
            )
        """))
        conn.execute(text("""
            UPDATE delivery_runs SET load_kg = (
                SELECT COALESCE(SUM(d.weight_kg), 0) FROM deliveries d WHERE d.run_id = delivery_runs.id
            )
            WHERE load_kg IS NULL
        """))
