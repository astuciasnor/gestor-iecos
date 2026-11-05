#!/usr/bin/env python3
"""Gera o QR Code de acesso a agenda publica do IECOS/UFPA."""

from pathlib import Path

import qrcode
from qrcode.image.pure import PyPNGImage


PUBLIC_AGENDA_URL = "https://cardume.iecos.ufpa.br/agenda_publica.html"  # desde 05/11/2026 (antes: GitHub)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = PROJECT_ROOT / "img" / "qrcode_agenda_publica.png"


def main() -> None:
    qr_code = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=20,
        border=4,
        image_factory=PyPNGImage,
    )
    qr_code.add_data(PUBLIC_AGENDA_URL)
    qr_code.make(fit=True)

    image = qr_code.make_image()
    image.save(str(OUTPUT_PATH))
    print(f"QR Code gerado em: {OUTPUT_PATH}")
    print(f"Destino: {PUBLIC_AGENDA_URL}")


if __name__ == "__main__":
    main()