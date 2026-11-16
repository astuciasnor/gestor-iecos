from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

OUT = r"d:\Git\planejador-academico\cardume\docs\casos_aproveitamento.xlsx"

DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
S1 = ["01/03", "02/03", "03/03", "04/03", "05/03", "06/03"]
S2 = ["08/03", "09/03", "10/03", "11/03", "12/03", "13/03"]
S3 = ["15/03", "16/03", "17/03", "18/03", "19/03", "20/03"]
AULAS = ["Aula 1", "Aula 2", "Aula 3", "Aula 4", "Aula 5"]

F = "Arial"
COR = {
    "A": ("70AD47", "FFFFFF"),    # verde
    "B": ("FFD966", "000000"),    # amarelo
    "C": ("E74C3C", "FFFFFF"),    # vermelho
    "X": ("7B0000", "FFFFFF"),    # choque A x C
    "-": ("D9D9D9", "808080"),    # dia que a Faixa 1 perdeu (corte)
    "C1": ("E74C3C", "FFFFFF"),   # C na Faixa 1
    "C2": ("F5B7B1", "7B0000"),   # C na Faixa 2 (vermelho claro)
    # outras componentes ja salvas (aulas em paralelo): verde / amarelo alternados
    "D": ("70AD47", "FFFFFF"), "F": ("70AD47", "FFFFFF"), "H": ("70AD47", "FFFFFF"),
    "E": ("FFD966", "000000"), "G": ("FFD966", "000000"),
}
fino = Side(style="thin", color="A6A6A6")
grosso = Side(style="medium", color="000000")
clique = Side(style="thick", color="000000")


def preencher(cel, valor):
    """valor: 'A', 'B', 'C', 'C*' (clique), 'X' (choque), '-' (cortada) ou ''."""
    estrela = valor.endswith("*")
    chave = valor.rstrip("*")
    outra = "A"
    if chave.startswith("X:"):          # choque com outra componente: 'X:H' -> 'H × C'
        outra, chave = chave[2:], "X"
    texto = {"X": f"{outra} × C", "-": "cortada", "C1": "C · F1", "C2": "C · F2"}.get(chave, chave)
    if estrela:
        texto = "C ★ clique"
    cel.value = texto or None
    if chave in COR:
        fundo, letra = COR[chave]
        cel.fill = PatternFill("solid", fgColor=fundo)
        cel.font = Font(name=F, bold=chave != "-", italic=chave == "-", color=letra, size=10)
    else:
        cel.font = Font(name=F, size=10)
    cel.alignment = Alignment(horizontal="center", vertical="center")


def grade(ws, linha, titulo, semanas, nota="", n=2):
    """semanas: dict 'S1'/'S2' -> {(aula 1..5, dia 0..5): valor}. Escreve o bloco e
    devolve a proxima linha livre."""
    ws.cell(linha, 1, titulo).font = Font(name=F, bold=True, size=12)
    if nota:
        ws.cell(linha, 3, nota).font = Font(name=F, italic=True, size=10, color="404040")
    linha += 1
    # cabecalho das semanas
    for base, nome in ((2, "Semana 1"), (9, "Semana 2"), (16, "Semana 3"))[:n]:
        ws.merge_cells(start_row=linha, start_column=base, end_row=linha, end_column=base + 5)
        c = ws.cell(linha, base, nome)
        c.font = Font(name=F, bold=True, size=10, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="404040")
        c.alignment = Alignment(horizontal="center")
    linha += 1
    ws.cell(linha, 1, "").font = Font(name=F)
    for base, datas in ((2, S1), (9, S2), (16, S3))[:n]:
        for i, d in enumerate(DIAS):
            c = ws.cell(linha, base + i, f"{d} {datas[i]}")
            c.font = Font(name=F, bold=True, size=10)
            c.fill = PatternFill("solid", fgColor="F2F2F2")
            c.alignment = Alignment(horizontal="center")
            c.border = Border(left=fino, right=fino, top=fino, bottom=fino)
    linha += 1
    for a in range(1, 6):
        r = linha + a - 1
        c = ws.cell(r, 1, AULAS[a - 1])
        c.font = Font(name=F, bold=True, size=10)
        c.alignment = Alignment(horizontal="right")
        for base, chave in ((2, "S1"), (9, "S2"), (16, "S3"))[:n]:
            for d in range(6):
                cel = ws.cell(r, base + d)
                v = semanas.get(chave, {}).get((a, d), "")
                preencher(cel, v)
                baixo = grosso if a == 3 else fino   # divisao 3 + 2 aulas
                lado = clique if v.endswith("*") else fino
                cel.border = Border(left=lado, right=lado,
                                    top=clique if v.endswith("*") else fino,
                                    bottom=clique if v.endswith("*") else baixo)
    return linha + 6


def bloco(dias, aulas, valor):
    """{(aula, dia): valor} para todas as combinacoes."""
    return {(a, d): valor for a in aulas for d in dias}


def junta(*partes):
    out = {}
    for p in partes:
        out.update(p)
    return out


T = range(1, 6)        # turno inteiro
A13 = range(1, 4)      # aulas 1-3
A45 = range(4, 6)      # aulas 4-5
SEMSEX = range(0, 5)

CASOS = []

# 1 - o caso do audio
A1 = bloco([1, 2], T, "A")
CASOS.append(dict(
    aba="Caso 1",
    titulo="Caso 1 — A às terças e quartas, toda semana (o seu caso)",
    situacao="A ocupa terça e quarta, aulas 1–5, todas as semanas (não contínua). C é a nova componente, marcada nas aulas 1–5 da segunda.",
    clique="Primeiro clique: segunda 01/03, aula 1.",
    conferencia="Conferência da regra: na primeira semana de A (ter 02/03 a seg 08/03), a segunda 08/03 aula 1 está LIVRE → A não é contínua → NÃO corta.",
    hoje=dict(S1=junta(A1, bloco([0], T, "C"), {(1, 0): "C*"}),
              S2=junta(A1, bloco([0], T, "-"))),
    hoje_nota="Faixa 1 de C termina dom 07/03 (1 dia só). ERRADO.",
    regra=dict(S1=junta(A1, bloco([0], T, "C"), {(1, 0): "C*"}),
               S2=junta(A1, bloco([0], T, "C"))),
    regra_nota="C segue toda segunda, sem corte. Cartão fixo: \"Sem corte de faixa: A não tem aula às segundas neste horário (conferido em 08/03/2027). Cada horário marcado se repete toda semana.\"",
))

# 2 - intensiva seg-sex a partir de quarta
A2s1 = bloco([2, 3, 4], T, "A")
A2s2 = bloco(SEMSEX, T, "A")
C2 = junta(bloco([0, 1], T, "C"), {(1, 0): "C*"})
CASOS.append(dict(
    aba="Caso 2",
    titulo="Caso 2 — A intensiva, de segunda a sexta, começando na quarta",
    situacao="A ocupa aulas 1–5, de segunda a sexta, a partir de qua 03/03 (contínua). C marcada nas aulas 1–5.",
    clique="Primeiro clique: segunda 01/03, aula 1.",
    conferencia="Conferência: na primeira semana de A (qua 03/03 a ter 09/03), a segunda 08/03 aula 1 está OCUPADA por A → contínua → CORTA na ter 02/03.",
    hoje=dict(S1=junta(A2s1, C2), S2=A2s2),
    hoje_nota="Faixa 1 de C: seg 01/03 a ter 02/03. Faixa 2 volta depois de A.",
    regra=dict(S1=junta(A2s1, C2), S2=A2s2),
    regra_nota="Igual a hoje.",
))

# 3 - parceira nas aulas 4-5
A3s1 = junta(bloco([2, 3, 4], A13, "A"), bloco([2, 3, 4], A45, "B"))
A3s2 = junta(bloco(SEMSEX, A13, "A"), bloco(SEMSEX, A45, "B"))
C3 = junta(bloco([0, 1], A45, "C"), {(4, 0): "C*"})
CASOS.append(dict(
    aba="Caso 3",
    titulo="Caso 3 — A nas aulas 1–3 e B (parceira) nas aulas 4–5, seg–sex",
    situacao="A ocupa aulas 1–3 e B ocupa aulas 4–5, de segunda a sexta, a partir de qua 03/03. C marcada nas aulas 4–5.",
    clique="Primeiro clique: segunda 01/03, aula 4.",
    conferencia="O app procura quem usa a AULA 4 adiante: acha B (não A). Na primeira semana de B, a segunda 08/03 aula 4 está OCUPADA por B → CORTA na ter 02/03 (\"corta pela parceira\").",
    hoje=dict(S1=junta(A3s1, C3), S2=A3s2),
    hoje_nota="Faixa 1 de C: seg 01/03 a ter 02/03.",
    regra=dict(S1=junta(A3s1, C3), S2=A3s2),
    regra_nota="Igual a hoje.",
))

# 4 - A so nas aulas 1-3, aulas 4-5 livres
A4s1 = bloco([2, 3, 4], A13, "A")
A4s2 = bloco(SEMSEX, A13, "A")
C4s1 = junta(bloco(SEMSEX, A45, "C"), {(4, 0): "C*"})
C4s2 = bloco(SEMSEX, A45, "C")
CASOS.append(dict(
    aba="Caso 4",
    titulo="Caso 4 — A intensiva só nas aulas 1–3, aulas 4–5 livres",
    situacao="A ocupa aulas 1–3, seg–sex, a partir de qua 03/03. Ninguém usa as aulas 4–5. C marcada nas aulas 4–5, seg–sex.",
    clique="Primeiro clique: segunda 01/03, aula 4.",
    conferencia="O app procura quem usa a AULA 4 adiante: ninguém → não há o que aproveitar → NÃO corta. C vira, na prática, a parceira de A.",
    hoje=dict(S1=junta(A4s1, C4s1), S2=junta(A4s2, C4s2)),
    hoje_nota="C segue nas aulas 4–5, sem corte.",
    regra=dict(S1=junta(A4s1, C4s1), S2=junta(A4s2, C4s2)),
    regra_nota="Igual a hoje.",
))

# 5 - ter+qua so nas aulas 1-3
A5 = bloco([1, 2], A13, "A")
CASOS.append(dict(
    aba="Caso 5",
    titulo="Caso 5 — A às terças e quartas só nas aulas 1–3",
    situacao="A ocupa terça e quarta, aulas 1–3, todas as semanas (não contínua). C marcada nas aulas 1–3 da segunda.",
    clique="Primeiro clique: segunda 01/03, aula 1.",
    conferencia="Conferência: na primeira semana de A, a segunda 08/03 aula 1 está LIVRE → não contínua → NÃO corta.",
    hoje=dict(S1=junta(A5, bloco([0], A13, "C"), {(1, 0): "C*"}),
              S2=junta(A5, bloco([0], A13, "-"))),
    hoje_nota="Faixa 1 de C termina dom 07/03 (1 dia só). ERRADO.",
    regra=dict(S1=junta(A5, bloco([0], A13, "C"), {(1, 0): "C*"}),
               S2=junta(A5, bloco([0], A13, "C"))),
    regra_nota="C segue toda segunda nas aulas 1–3. Cartão fixo \"Sem corte de faixa\" (conferido em 08/03/2027).",
))

# 6 - intensiva curta qua-sex, depois B na segunda
A6 = bloco([2, 3, 4], T, "A")
B6 = bloco(SEMSEX, T, "B")
CASOS.append(dict(
    aba="Caso 6",
    titulo="Caso 6 — A intensiva curta (qua a sex) e B começando na segunda seguinte",
    situacao="A ocupa aulas 1–5 só de qua 03/03 a sex 05/03. B ocupa aulas 1–5, seg–sex, a partir de seg 08/03. C marcada nas aulas 1–5.",
    clique="Primeiro clique: segunda 01/03, aula 1.",
    conferencia="Conferência: na primeira semana de A (qua 03/03 a ter 09/03), a segunda 08/03 aula 1 está OCUPADA (por B) → CORTA na ter 02/03.",
    hoje=dict(S1=junta(A6, bloco([0, 1], T, "C"), {(1, 0): "C*"}), S2=B6),
    hoje_nota="Faixa 1 de C: seg 01/03 a ter 02/03.",
    regra=dict(S1=junta(A6, bloco([0, 1], T, "C"), {(1, 0): "C*"}), S2=B6),
    regra_nota="Igual a hoje.",
))

# 7 - print 2: o que e parceira
CASOS.append(dict(
    aba="Parceira",
    titulo="O que é \"parceira\" (print 2)",
    situacao="Esquema 3 + 2: A usa as aulas 1–3 e B usa as aulas 4–5, nos mesmos dias (seg–sex, a partir de qua 03/03). B é a parceira de A.",
    clique="Sem componente nova: só o desenho das duas que já existem.",
    conferencia="Quem decide o corte é a componente que usa o MESMO horário clicado. Clique na aula 1 → quem decide é A. Clique na aula 4 → quem decide é B. Como começam juntas, o corte cai no mesmo dia.",
    hoje=dict(S1=A3s1, S2=A3s2),
    hoje_nota="A e B como estão salvas.",
    regra=None,
))

# 8 - print 3: C tambem quer as aulas 1-3
A8s1 = bloco([2, 3, 4], A13, "A")
A8s2 = bloco(SEMSEX, A13, "A")
# 8a: primeiro clique na aula 1 -> corta na terca
C8a = junta(bloco([0, 1], T, "C"), {(1, 0): "C*"})
# 8b: primeiro clique na aula 4 -> nao corta; C em 1-5 bate em A
C8b_s1 = junta(bloco(SEMSEX, A45, "C"), bloco([0, 1], A13, "C"), bloco([2, 3, 4], A13, "X"), {(4, 0): "C*"})
C8b_s2 = junta(bloco(SEMSEX, A45, "C"), bloco(SEMSEX, A13, "X"))
CASOS.append(dict(
    aba="Print 3 (C nas aulas 1-3)",
    titulo="Print 3 — A só nas aulas 1–3 e C também quer as aulas 1–3 (turno inteiro)",
    situacao="A ocupa aulas 1–3, seg–sex, a partir de qua 03/03. Aulas 4–5 livres. C quer as aulas 1–5 (turno inteiro).",
    clique="Duas ordens de clique: (a) primeiro na aula 1; (b) primeiro na aula 4 e depois as aulas 1–3.",
    conferencia="O app decide o aproveitamento só no PRIMEIRO clique. Por isso a Ajuda manda clicar primeiro no horário mais cedo do dia.",
    hoje=dict(S1=junta(A8s1, C8a), S2=A8s2),
    hoje_titulo="(a) Primeiro clique na segunda, AULA 1 — hoje e com a regra",
    hoje_nota="Acha A na aula 1; seg 08/03 ocupada → CORTA na ter 02/03. Certo.",
    regra=dict(S1=junta(A8s1, C8b_s1), S2=C8b_s2),
    regra_titulo="(b) Primeiro clique na segunda, AULA 4 — hoje e com a regra",
    regra_nota="Ninguém na aula 4 → não corta. Ao marcar 1–3, C bate em A (A × C): aparece o aviso de choque.",
))

# 9 - sabado
A9 = bloco(SEMSEX, T, "A")
CASOS.append(dict(
    aba="Sábado",
    titulo="Sábado — A intensiva seg–sex sem sábado, clique no sábado antes dela (mudança aceita)",
    situacao="A ocupa aulas 1–5, seg–sex, a partir de seg 08/03, sem sábado. C marcada nas aulas 1–5 do sábado.",
    clique="Primeiro clique: sábado 06/03, aula 1.",
    conferencia="Conferência: na primeira semana de A (seg 08/03 a dom 14/03), o sábado 13/03 aula 1 está LIVRE → NÃO corta (decidido: sem exceção).",
    hoje=dict(S1=junta(bloco([5], T, "C"), {(1, 5): "C*"}), S2=junta(A9, bloco([5], T, "-"))),
    hoje_nota="Faixa 1 de C: só sáb 06/03.",
    regra=dict(S1=junta(bloco([5], T, "C"), {(1, 5): "C*"}), S2=junta(A9, bloco([5], T, "C"))),
    regra_nota="C segue todo sábado, sem corte. Cartão fixo \"Sem corte de faixa: A não tem aula aos sábados…\". (Decidido: sem exceção.)",
))

# 10 - print 4: a faixa diferente na primeira semana (proposta do usuario)
A10s1 = bloco([2, 3, 4], A13, "A")
A10s2 = bloco(SEMSEX, A13, "A")
prop_s1 = junta(A10s1, bloco([0, 1], T, "C1"), bloco([2, 3, 4], A45, "C1"), {(1, 0): "C1*"})
prop_s2 = junta(A10s2, bloco(SEMSEX, A45, "C2"))
app_s1 = junta(A10s1, bloco([0, 1], T, "C1"), bloco([2, 3, 4], A45, "C2"), {(1, 0): "C1*"})
app_s2 = junta(A10s2, bloco(SEMSEX, A45, "C2"))
CASOS.append(dict(
    aba="Print 4 (faixa na 1a semana)",
    titulo="Print 4 — C usa a 1ª semana inteira: aulas 1–5 seg–ter e aulas 4–5 qua–sex",
    situacao="Mesma situação do Print 3: A ocupa aulas 1–3, seg–sex, a partir de qua 03/03; aulas 4–5 livres. C quer aproveitar tudo.",
    clique="Primeiro clique: segunda 01/03, AULA 1 (o caso (a) do Print 3), e depois \"Preencher a Faixa 2\".",
    conferencia="Pelo código: a data sugerida aqui é qua 03/03, AULA 4 (A é intensiva de meio turno: o app sugere o par 3 + 2). A Faixa 2 volta nela. Resultado: as MESMAS células da sua proposta, só muda onde a Faixa 1 termina.",
    hoje=dict(S1=prop_s1, S2=prop_s2),
    hoje_titulo="Sua proposta",
    hoje_nota="F1 = sem. 1 (seg–ter aulas 1–5 + qua–sex aulas 4–5). F2 = a partir de seg 08/03, aulas 4–5.",
    regra=dict(S1=app_s1, S2=app_s2),
    regra_titulo="O que o app faz (hoje e com a regra)",
    regra_nota="F1 = seg–ter aulas 1–5 (corta na véspera de A). F2 = a partir de qua 03/03, aulas 4–5. Mesmas horas: 16h na sem. 1, 10h na sem. 2.",
))

# 11-14 - componentes em paralelo (faculdade nao continua): 6 componentes,
# cada uma em um dia da semana, toda semana.
def paralelas(semana):
    return junta(bloco([0], A13, "A"), bloco([0], A45, "B"), bloco([1], T, "D"),
                 bloco([2], A13, "E"), bloco([3], T, "F"), bloco([4], A13, "G")) if semana else {}

P = paralelas(True)
DESC_P = ("Seis componentes em paralelo, toda semana: A seg 1–3, B seg 4–5, D ter 1–5, E qua 1–3, F qui 1–5, G sex 1–3. "
          "Sobram livres: qua 4–5, sex 4–5 e sábado.")

# 11 - as 6 ja comecam na semana 1
CASOS.append(dict(
    aba="Paralelas 1",
    titulo="Paralelas 1 — as 6 começam na semana 1; C entra no horário livre",
    situacao=DESC_P + " Todas começam seg 01/03. C marcada nas aulas 4–5 de qua e sex.",
    clique="Primeiro clique: quarta 03/03, aula 4 (é a própria data sugerida).",
    conferencia="Clique NA data sugerida (não antes dela) → o app nem procura aproveitamento. C segue toda semana em qua e sex 4–5.",
    hoje=dict(S1=junta(P, bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C1"))),
    hoje_nota="Uma faixa só, semanal.",
    regra=dict(S1=junta(P, bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C1"))),
    regra_nota="Igual a hoje.",
))

# 12 - as 6 comecam na semana 2; C entra no horario que sobra livre
CASOS.append(dict(
    aba="Paralelas 2",
    titulo="Paralelas 2 — as 6 começam na semana 2; C clica antes, num horário que fica livre",
    situacao=DESC_P + " Todas começam seg 08/03 (semana 1 vazia). C marcada nas aulas 4–5 de qua e sex.",
    clique="Primeiro clique: quarta 03/03, aula 4 (antes da data sugerida, qua 10/03 aula 4).",
    conferencia="O app acha B (a primeira que usa a aula 4, seg 08/03). Conferência: na 1ª semana de B, a quarta 10/03 aula 4 está LIVRE → NÃO corta.",
    hoje=dict(S1=junta(bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C2"))),
    hoje_nota="Corta em dom 07/03 por causa de B (que nem usa quarta). C precisa refazer tudo na Faixa 2. Desnecessário.",
    regra=dict(S1=junta(bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C1"))),
    regra_nota="Uma faixa só, semanal, desde 03/03. Cartão fixo \"Sem corte de faixa: B não tem aula às quartas neste horário (conferido em 10/03/2027)\".",
))

# 13 - as 6 comecam na semana 2; C clica num horario que vai ser ocupado
CASOS.append(dict(
    aba="Paralelas 3",
    titulo="Paralelas 3 — as 6 começam na semana 2; C clica num horário que vai ser ocupado",
    situacao=DESC_P + " Todas começam seg 08/03. C marcada na seg aulas 1–5 da semana 1 (exemplo).",
    clique="Primeiro clique: segunda 01/03, aula 1 (antes da data sugerida, qua 10/03 aula 4).",
    conferencia="O app acha A (seg 08/03, aula 1). Conferência: na 1ª semana de A, a segunda 08/03 aula 1 está OCUPADA → CORTA em dom 07/03. A Faixa 2 volta na data sugerida (qua 10/03, aula 4).",
    hoje=dict(S1=junta(bloco([0], T, "C1"), {(1, 0): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C2"))),
    hoje_nota="F1 = semana 1. F2 = qua e sex 4–5 a partir de 10/03 (exemplo).",
    regra=dict(S1=junta(bloco([0], T, "C1"), {(1, 0): "C1*"}), S2=junta(P, bloco([2, 4], A45, "C2"))),
    regra_nota="Igual a hoje: o corte protege a segunda, que passa a ser de A e B.",
))

# 14 - o horario livre e tomado por outra (H) na semana seguinte
P4 = junta(P, bloco([2], A45, "H"))
CASOS.append(dict(
    aba="Paralelas 4",
    titulo="Paralelas 4 — o horário livre de quarta é tomado por H na semana 2",
    situacao=DESC_P + " As 6 começam seg 08/03; H ocupa qua 4–5 a partir de qua 10/03. C marcada nas aulas 4–5 de qua e sex.",
    clique="Primeiro clique: quarta 03/03, aula 4 (antes da data sugerida, sex 12/03 aula 4).",
    conferencia="O app acha B (seg 08/03, aula 4). Conferência: na 1ª semana de B, a quarta 10/03 aula 4 está OCUPADA (por H) → CORTA em dom 07/03. Vale qualquer componente ocupando, não só B.",
    hoje=dict(S1=junta(bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P4, bloco([4], A45, "C2"))),
    hoje_nota="F1 = semana 1 (qua e sex). F2 = sex 4–5 a partir de 12/03.",
    regra=dict(S1=junta(bloco([2, 4], A45, "C1"), {(4, 2): "C1*"}), S2=junta(P4, bloco([4], A45, "C2"))),
    regra_nota="Igual a hoje. LIMITE: se H começasse só na semana 3 ou depois, não cortaria → ver aba Paralelas 5.",
))

# 15 - H so na semana 3 (o limite da regra)
P5_s3 = junta(P, bloco([2], A45, "H"))
C5_s1 = junta(bloco([2, 4], A45, "C1"), {(4, 2): "C1*"})
CASOS.append(dict(
    aba="Paralelas 5",
    n=3,
    titulo="Paralelas 5 — o horário livre de quarta só é tomado por H na semana 3 (o limite da regra)",
    situacao=DESC_P + " As 6 começam seg 08/03; H ocupa qua 4–5 só a partir de qua 17/03. C marcada nas aulas 4–5 de qua e sex.",
    clique="Primeiro clique: quarta 03/03, aula 4 (antes da data sugerida, sex 19/03 aula 4).",
    conferencia="O app acha B (seg 08/03, aula 4). Conferência: na 1ª semana de B (08 a 14/03), a quarta 10/03 aula 4 está LIVRE → com a regra, NÃO corta. H só aparece na semana 3.",
    hoje=dict(S1=C5_s1, S2=junta(P, bloco([2, 4], A45, "-")), S3=junta(P5_s3, bloco([4], A45, "C2"))),
    hoje_nota="Corta em dom 07/03 por causa de B; a F2 só volta na data sugerida (sex 19/03). A semana 2 fica perdida; o choque com H é evitado por acaso.",
    regra=dict(S1=C5_s1, S2=junta(P, bloco([2, 4], A45, "C1")), S3=junta(P, bloco([2], A45, "X:H"), bloco([4], A45, "C1"))),
    regra_nota="Uma faixa só. Na semana 3, quarta 4–5: H × C → aviso de choque. O app só avisa; você decide (mudar C ou H de horário).",
    extra=dict(S1=C5_s1, S2=junta(P, bloco([2, 4], A45, "C1")), S3=junta(P5_s3, bloco([4], A45, "C2"))),
    extra_titulo="Possível à mão, mas EVITAR (decidido)",
    extra_nota="Qua+sex nas semanas 1–2 e só sex depois: calendário estranho. O app não faz isso sozinho; melhor mudar C ou H de horário.",
))


def legenda(ws, linha):
    ws.cell(linha, 1, "Legenda").font = Font(name=F, bold=True, size=11)
    itens = [("A", "A — componente já salva"), ("B", "B — componente já salva (parceira)"),
             ("C", "C — componente nova (o que o app preenche)"), ("C*", "clique — primeiro horário clicado"),
             ("X", "A × C — choque"), ("-", "cortada — dia que a Faixa 1 de C perde"),
             ("C1", "C · F1 — componente nova, Faixa 1"), ("C2", "C · F2 — componente nova, Faixa 2"),
             ("E", "D, E, F, G, H — outras já salvas (verde/amarelo alternados)")]
    for i, (k, txt) in enumerate(itens):
        cel = ws.cell(linha + 1 + i, 2)
        preencher(cel, k)
        cel.border = Border(left=clique, right=clique, top=clique, bottom=clique) if k == "C*" else Border(left=fino, right=fino, top=fino, bottom=fino)
        ws.cell(linha + 1 + i, 3, txt).font = Font(name=F, size=10)
    ws.cell(linha + 11, 1, "Linha grossa entre as aulas 3 e 4 = divisão 3 + 2 do turno. Sem aula aos domingos. Datas de exemplo (mar/2027).").font = Font(name=F, italic=True, size=9, color="606060")


wb = Workbook()
wb.remove(wb.active)
for caso in CASOS:
    ws = wb.create_sheet(caso["aba"][:31])
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 9
    n = caso.get("n", 2)
    for col in range(2, 22):
        ws.column_dimensions[ws.cell(1, col).column_letter].width = 11
    ws.column_dimensions["H"].width = 3
    ws.column_dimensions["O"].width = 3
    ws.cell(1, 1, caso["titulo"]).font = Font(name=F, bold=True, size=14)
    ws.cell(2, 1, caso["situacao"]).font = Font(name=F, size=10)
    ws.cell(3, 1, caso["clique"]).font = Font(name=F, size=10, bold=True)
    ws.cell(4, 1, caso["conferencia"]).font = Font(name=F, size=10, color="1F4E79")
    linha = 6
    t1 = caso.get("hoje_titulo") or ("Desenho" if caso["regra"] is None else "HOJE")
    linha = grade(ws, linha, t1, caso["hoje"], caso.get("hoje_nota", ""), n)
    if caso["regra"] is not None:
        t2 = caso.get("regra_titulo") or "COM A REGRA"
        linha = grade(ws, linha + 1, t2, caso["regra"], caso.get("regra_nota", ""), n)
    if caso.get("extra"):
        linha = grade(ws, linha + 1, caso["extra_titulo"], caso["extra"], caso.get("extra_nota", ""), n)
    legenda(ws, linha + 1)
    for r in range(8, linha):
        ws.row_dimensions[r].height = 20
    ws.freeze_panes = None

# Aba final: a regra e as decisoes (16/11/2026)
ws = wb.create_sheet("Resumo da regra")
ws.sheet_view.showGridLines = False
for col, w in zip("ABCDE", (34, 22, 40, 34, 14)):
    ws.column_dimensions[col].width = w
ws.cell(1, 1, "Regra da 1ª semana (decidida em 16/11/2026)").font = Font(name=F, bold=True, size=14)
regra = [
    "1. Clique num dia livre ANTES da data sugerida: o app procura a componente da frente (a primeira que usa o MESMO horário clicado, em qualquer dia).",
    "2. Na primeira semana dela, o mesmo dia da semana e horário do clique está OCUPADO (por ela ou por outra)? → a Faixa 1 termina na véspera dela e a Faixa 2 volta na data sugerida.",
    "3. Está LIVRE? → não corta: o clique só marca o início e um cartão fixo explica \"Sem corte de faixa: X não tem aula às <dias> neste horário (conferido em dd/mm/aaaa)\".",
    "4. Feriado nesse dia → confere a semana seguinte.",
    "5. Choques em semanas mais adiante ficam com o aviso de choque: o app só avisa, você decide. Nada de regra com exceção.",
    "6. O aproveitamento é decidido só no PRIMEIRO clique: clique primeiro no horário mais cedo que a componente vai usar (frase na Ajuda).",
    "7. A faixa muda no dia em que a ocupação muda (não no fim da semana).",
]
for i, t in enumerate(regra):
    c = ws.cell(3 + i, 1, t)
    c.font = Font(name=F, size=10)
    ws.merge_cells(start_row=3 + i, start_column=1, end_row=3 + i, end_column=5)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[3 + i].height = 28
linha = 3 + len(regra) + 1
cab = ["Aba", "Primeiro clique", "Na 1ª semana da componente da frente", "Resultado", "Muda?"]
for j, t in enumerate(cab):
    c = ws.cell(linha, 1 + j, t)
    c.font = Font(name=F, bold=True, size=10, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="404040")
linhas = [
    ("Caso 1 · A ter+qua semanal", "seg aula 1", "seg livre", "não corta", "sim"),
    ("Caso 2 · A intensiva seg–sex desde qua", "seg aula 1", "seg ocupada por A", "corta na terça", "não"),
    ("Caso 3 · A 1–3 + B parceira 4–5", "seg aula 4", "seg ocupada por B", "corta na terça", "não"),
    ("Caso 4 · A só 1–3, aulas 4–5 livres", "seg aula 4", "ninguém usa a aula 4", "não corta (só aviso de início)", "não"),
    ("Caso 5 · A ter+qua só 1–3", "seg aula 1", "seg livre", "não corta", "sim"),
    ("Caso 6 · A curta qua–sex + B na segunda", "seg aula 1", "seg ocupada por B", "corta na terça", "não"),
    ("Print 3 (a) / Print 4 · C quer 1–5", "seg aula 1", "seg ocupada por A", "corta; F2 volta qua aula 4", "não"),
    ("Print 3 (b) · mesma situação", "seg aula 4", "ninguém usa a aula 4", "não corta → choque ao marcar 1–3", "não"),
    ("Sábado · A seg–sex sem sábado", "sáb aula 1", "sáb livre", "não corta (aceito)", "sim"),
    ("Paralelas 1 · as 6 desde a semana 1", "na data sugerida", "—", "não procura: faixa única", "não"),
    ("Paralelas 2 · as 6 desde a semana 2", "qua aula 4", "qua livre", "não corta", "sim"),
    ("Paralelas 3 · idem", "seg aula 1", "seg ocupada por A", "corta", "não"),
    ("Paralelas 4 · H na qua 4–5 desde a semana 2", "qua aula 4", "qua ocupada por H", "corta", "não"),
    ("Paralelas 5 · H só desde a semana 3", "qua aula 4", "qua livre", "não corta → choque na semana 3; você decide", "sim"),
]
for i, row in enumerate(linhas):
    for j, t in enumerate(row):
        c = ws.cell(linha + 1 + i, 1 + j, t)
        c.font = Font(name=F, size=10, bold=(j == 4 and t == "sim"), color=("C0392B" if (j == 4 and t == "sim") else "000000"))
        c.border = Border(bottom=fino)
        c.alignment = Alignment(wrap_text=True, vertical="top")
ws.cell(linha + len(linhas) + 2, 1, "\"Muda?\" = resultado diferente do app de hoje (antes da branch aproveitamento-nao-continua).").font = Font(name=F, italic=True, size=9, color="606060")

wb.save(OUT)
print("ok", OUT)
