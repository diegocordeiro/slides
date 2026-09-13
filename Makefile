# ============================================================
#  Slides IFPI — automação local (make)
#  Compatível com o GNU Make 3.81 do macOS: receitas com TAB.
#
#  Nenhum alvo conhece nomes de aulas: a descoberta é feita pelo
#  scripts/gerar_index.py, portanto pastas e disciplinas novas
#  entram automaticamente em TODOS os alvos.
# ============================================================

PY      ?= python3
PORTA   ?= 8000
BRANCH  ?= main
MSG     ?= Atualiza slides e indice das aulas
SITE    ?= https://diegocordeiro.github.io/slides/
CHROME  ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

SHELL := /bin/bash
.DEFAULT_GOAL := ajuda

.PHONY: ajuda listar index checar servir publicar acompanhar site status limpar

ajuda:
	@echo "Slides IFPI — alvos disponíveis:"
	@echo ""
	@echo "  make listar        lista as aulas detectadas (inclusive pastas novas)"
	@echo "  make index         regenera o index.html a partir das aulas"
	@echo "  make checar        valida as referências de todas as aulas"
	@echo "  make servir        gera o índice e serve em http://localhost:$(PORTA)"
	@echo "  make publicar      index + checar + commit + push (MSG=\"...\")"
	@echo "  make acompanhar    acompanha o deploy no GitHub Actions"
	@echo "  make site          abre $(SITE)"
	@echo "  make status        branch, pendências locais e último deploy"
	@echo "  make limpar        remove _site/, __pycache__/ e .DS_Store"
	@echo ""
	@echo "Variáveis: PORTA=$(PORTA) BRANCH=$(BRANCH)"

listar:
	@$(PY) scripts/gerar_index.py --listar

index:
	@$(PY) scripts/gerar_index.py --sem-data

checar:
	@$(PY) scripts/checar_referencias.py

servir: index
	@echo "Servindo em http://localhost:$(PORTA) — Ctrl+C encerra"
	@$(PY) -m http.server $(PORTA)

publicar: index checar
	@git add -A
	@if git diff --cached --quiet; then \
		echo "Sem mudanças para commitar — enviando o estado atual."; \
	else \
		git commit -q -m "$(MSG)"; echo "Commit criado: $(MSG)"; \
	fi
	@git push origin $(BRANCH)
	@echo ""
	@echo "Deploy disparado. Acompanhe com 'make acompanhar'."

acompanhar:
	@ID=$$(gh run list -L 1 --json databaseId --jq '.[0].databaseId'); \
	echo "Acompanhando o run $$ID ..."; \
	gh run watch $$ID --exit-status && echo "Deploy concluído com sucesso." \
		|| echo "Atenção: o run terminou com falha (veja a saída acima)."
	@echo "Site: $(SITE)"

site:
	@open "$(SITE)"

status:
	@echo "branch : $$(git branch --show-current)"
	@echo "site   : $(SITE)"
	@echo "último deploy:"
	@gh run list -L 1
	@echo "pendências locais:"
	@git status -s

limpar:
	@rm -rf _site scripts/__pycache__
	@find . -name '.DS_Store' -not -path './.git/*' -delete
	@echo "Removidos: _site/, __pycache__/ e arquivos .DS_Store"
