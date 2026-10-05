"""Validação dos documentos usados nos cadastros (CPF e placa)."""

import re

# ABC1234 (padrão antigo) ou ABC1D23 (Mercosul)
PLATE_RE = re.compile(r"^[A-Z]{3}\d[A-Z0-9]\d{2}$")


def is_valid_cpf(cpf: str) -> bool:
    digits = re.sub(r"\D", "", cpf)
    if len(digits) != 11 or digits == digits[0] * 11:
        return False
    for size in (9, 10):
        total = sum(int(d) * (size + 1 - i) for i, d in enumerate(digits[:size]))
        if total * 10 % 11 % 10 != int(digits[size]):
            return False
    return True


def normalize_plate(plate: str) -> str:
    return re.sub(r"[\s-]", "", plate).upper()


def is_valid_plate(plate: str) -> bool:
    return bool(PLATE_RE.match(plate))
