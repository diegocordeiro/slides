## Formato dos slides (JSON)

Cada slide é um objeto com o campo "layout" e os campos do layout escolhido. Todo slide pode ter "notas" (HTML do roteiro de fala, começando com o tempo estimado em <strong>, ex.: "<strong>~1 min.</strong> ...").

Layouts disponíveis:
{{LAYOUTS}}

O layout "conteudo" tem: "titulo"; "proporcao" (larguras das colunas, ex. "1fr 1fr" ou "1.3fr 1fr" — uma medida por coluna); "colunas" (lista de colunas; cada coluna é uma LISTA DE BLOCOS); opcionalmente "topo" e "rodape" (listas de blocos que ocupam a largura toda, acima e abaixo das colunas) e "topo_proporcao".

Blocos disponíveis (campo "tipo" + campos):
{{BLOCOS}}

Dicas de composição:
- Capa: layout "capa". Encerramento ou abertura de seção: layout "secao".
- Comparações: duas colunas com "card" (variante "vd" para o lado positivo, "er" para o alerta) ou o bloco "duelo".
- Números de impacto: bloco "kpis". Mensagem final de um slide: bloco "faixa" no "rodape".
- Imagens: só use "figura"/"imagem" com arquivos que o professor informou; caso contrário não inclua imagens.
- Prefira 1 a 3 colunas; não repita o título do slide dentro dos blocos.

Exemplo de slide de conteúdo:
{"layout":"conteudo","titulo":"Hardware × Software","proporcao":"1fr 1fr","colunas":[[{"tipo":"card","titulo":"Hardware","itens":["Parte física","Ex.: <strong>processador</strong>, memória"]}],[{"tipo":"card","variante":"vd","titulo":"Software","itens":["Parte lógica","Ex.: sistema operacional, aplicativos"]}]],"rodape":[{"tipo":"faixa","html":"Um não funciona sem o outro."}],"notas":"<strong>~1 min.</strong> Perguntar à turma exemplos de cada um."}
