# FrotaGest

Gestão de frotas e motoristas para distribuidoras e transportadoras: rastreamento integrado
(Sascar, Onixsat e outros), rotas e km por motorista, chat e, nas próximas fases, pneus, custos e jornada.

```
frotagest/
├── backend/    API em Python (FastAPI + SQLAlchemy) e worker dos rastreadores
├── frontend/   Painel web do gestor (React + TypeScript + styled-components)
└── docker-compose.yml   Postgres + API + worker
```

## Requisitos

- Python 3.11 ou mais novo
- Node.js 20 ou mais novo
- Docker (opcional, só para usar Postgres)

## 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env               # Windows: copy .env.example .env
python -m app.seed                 # cria empresa, gestor, 3 motoristas, veículos e posições simuladas
python -m app.mock_data            # (opcional) 6 motoristas de teste com 2 semanas de rotas e cargas para hoje
uvicorn app.main:app --reload
```

A documentação interativa da API fica em http://localhost:8000/docs.

Para continuar gerando posições simuladas enquanto desenvolve, rode o worker em outro terminal:

```bash
python -m app.workers.poller
```

Testes: `pytest`

## 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173. O Vite encaminha `/api` para o backend na porta 8000.

### Logins de exemplo

| Perfil    | Login                  | Senha        |
|-----------|------------------------|--------------|
| Gestor    | gestor@frotagest.dev   | gestor123    |
| Motorista | 111.111.111-11         | motorista123 |
| Motorista | 222.222.222-22         | motorista123 |
| Motorista | 333.333.333-33         | motorista123 |


### Dados de teste

`python -m app.mock_data` cria (ou recria, com as datas do dia) seis motoristas de teste com veículos de tipos
diferentes (Fiorino, Master, Sprinter, Delivery, Daily e Ducato), pneus, CNH (uma vencendo em 20 dias) e o rastreador
simulado ligado; duas semanas de rotas feitas em todas as regiões de preço (às vezes duas no mesmo dia), com entregas
feitas (com nome e assinatura de quem recebeu) e não recebidas com foto, checklists (alguns com pendência),
abastecimentos com cupom, despesas aprovadas, recusadas e esperando análise, trajeto no mapa, km e pagamentos (os mais
antigos pagos); telefone dos clientes; cargas nos caminhões para
hoje e amanhã e entregas na fila do carregamento. Os motoristas entram com o CPF que o comando mostra e a senha
`teste123`. `python -m app.mock_data --remove` apaga só esses dados (motoristas, veículos e entregas "TST-...").

## 3. Postgres com Docker (opcional)

```bash
cp backend/.env.example backend/.env
docker compose up --build
docker compose exec api python -m app.seed
```

## O que já está pronto

**Backend**
- Login com JWT: gestor entra por e-mail, motorista por CPF. Motorista só vê os próprios dados.
- Multiempresa: todos os dados são isolados por `company_id`.
- Cadastro de veículos e motoristas (`/api/vehicles`, `/api/drivers`). O motorista é cadastrado com CNH (número, categoria e validade)
  e pode já receber um veículo existente ou um novo; CPF e placa são validados.
- Veículos (`/api/vehicles`): o gestor cadastra, edita tudo (placa, rastreador, consumo, rodado traseiro) e troca o
  motorista (quem recebe um veículo deixa o anterior). `DELETE /api/vehicles/{id}` exclui com as posições, as rotas
  feitas com ele e os pneus; `/usage` mostra antes o que vai junto. Veículo em rota não pode ser excluído.
- Remover motorista (`DELETE /api/drivers/{id}`), por exemplo numa demissão: perde o acesso na hora (o app aberto é
  desconectado), o veículo fica livre, as entregas que faltavam voltam para a fila, a rota em andamento é encerrada e ele
  sai dos grupos do chat. O histórico fica guardado (Lei 13.103). `POST /api/drivers/{id}/reactivate` devolve o acesso.
  `DELETE /api/drivers/{id}/permanent` exclui de vez um motorista já removido: cadastro, rotas, pontos de GPS, pausas,
  comprovantes (e as fotos), as mensagens dele e as conversas individuais com ele. As entregas ficam, sem o nome dele,
  e os km das rotas apagadas continuam no total do veículo (`vehicles.archived_route_km`) para o desgaste dos pneus.
- Veículo pelo motorista: sem veículo, ele cadastra o dele (`POST /api/vehicles`, que já fica no nome dele); com veículo,
  preenche só o que a base deixou em branco (`PATCH /api/vehicles/{id}`). O gestor pode alterar qualquer dado pelo mesmo `PATCH`.
- Carregamento (`/api/deliveries`): entregas do dia ou de um período (`date_from`/`date_to`), distribuição entre motoristas
  na ordem das paradas e devolução para a fila. O motorista é avisado na hora pelo WebSocket quando ganha ou perde entregas.
- Rastreamento: posição ao vivo, rotas por dia/motorista/veículo com km, tempo de direção, velocidade máxima e excessos, pontos do trajeto e resumo do painel.
- Rota de entrega (`/api/delivery-runs`): o motorista inicia a rota do dia; as entregas são localizadas no mapa
  (Nominatim, com cache em `geocoded_addresses`) e o OSRM calcula a ordem mais rápida pelas ruas, saindo da base e
  voltando a ela. As paradas são renumeradas nessa ordem. Os km rodados vêm do rastreador do veículo e, sem ele, do GPS
  do celular (`/points`). Entrega nova durante a rota pede para recalcular a partir de onde o caminhão está.
- Pausas na rota (`/api/delivery-runs/{id}/pauses`): refeição, descanso e espera de carga e descarga, com o gestor vendo
  na hora quem está em pausa.
- Comprovante de entrega (`POST /api/deliveries/{id}/outcome`): no endereço, o motorista envia uma foto da entrega feita
  ou do cliente que não recebeu (com o motivo). O gestor recebe o aviso pelo WebSocket; a foto fica em `UPLOAD_DIR`
  e sai só para quem tem acesso (`/api/deliveries/{id}/proof/photo`). Entrega não recebida pode voltar para a fila.
- Pneus (`/api/tires`, `/api/vehicles/{id}/tires`): posição (conforme o rodado: simples, como vans, sem pneus internos,
  ou duplo), marca, nº de fogo, sulco do pneu novo, medição em % ou em mm (1,6 mm, o mínimo legal da Resolução
  CONTRAN 913/2022, é 0% de banda), vida útil e preço. Previsão de km até o rodízio (50% de desgaste) e até a troca (75%).
  O desgaste é estimado pelos km rodados nas rotas desde a última medição; o estepe não gasta. Histórico de montagem,
  medição, rodízio (troca de posição) e recapagem com custo (`/tires/{id}/events`, `/rotate`, `/retread`).
- Custos (`/api/costs`): preço do litro de diesel S10 e gasolina pela pesquisa semanal da ANP (cidade da base ou média
  do estado, atualizado sozinho a cada semana) ou informado pela empresa; custo por veículo no período com combustível
  (km ÷ consumo × preço) e pneus (preço ÷ vida útil × km), com filtro por combustível.
- Sugestões de endereço (`/api/address`): cidades pela lista de municípios do IBGE (o ViaCEP não busca cidade por nome)
  e ruas ou CEP pelo ViaCEP. As respostas ficam em cache na memória do servidor.
- Base da empresa (`/api/company/base`): ponto do CD com raio. O dia de cada caminhão é dividido em viagens
  (saída e volta da base, `/api/tracking/routes/{id}/detail`) e o caminhão dentro do raio aparece como "Na base".
- Chat: conversas em grupo e individuais, histórico e WebSocket em tempo real (`/api/chat/ws`). Contatos por perfil
  (`/api/chat/contacts`: o gestor fala com todos, o motorista com a base), uma conversa individual por dupla,
  grupos criados e editados só por gestores e contagem de mensagens não lidas.
- Integrações em `app/integrations/`: interface comum, simulador funcionando, Sascar (SasIntegra/SOAP) pelo contrato do
  WSDL oficial e Onixsat como ponto de partida. A conexão é feita em Configurações → Rastreadores
  (`PUT /api/company/trackers/sascar`, testa antes de salvar e nunca devolve a senha) e cada veículo pode ser conferido
  em `POST /api/vehicles/{id}/tracker-check` (está transmitindo? última posição e endereço; as posições já vão para o mapa).
- Worker que consulta os rastreadores e guarda o histórico (a Sascar só mantém D0/D1).
- Pagamento dos motoristas (`/api/payments`): o valor de cada rota é sempre o preço da região dela, lançado quando a
  rota é encerrada (as encerradas sem nenhuma entrega registrada o gestor lança em `/runs/{id}/launch`, também pelo preço
  da região). O gestor marca como pago (com a data) ou desfaz. O motorista vê o saldo dele (`/api/payments/overview`) e
  recebe um aviso pelo WebSocket quando um valor é lançado ou pago.
  Os valores ficam em centavos (`driver_payments.amount_cents`).
- Preço fixo da rota por região (`/api/route-regions`): cada rota vale um preço fixo, não importa quantas entregas leve.
  A entrega cai na região que lista a cidade dela ou, senão, na primeira faixa de distância da base (linha reta); a rota
  vale a região mais cara. A região e o preço ficam guardados na rota ao calculá-la (`delivery_runs.region_price_cents`;
  ao recalcular só sobe) e, ao encerrar com entregas resolvidas, o preço entra sozinho como valor a pagar.
  `/estimate` mostra o valor previsto do carregamento antes de a rota começar. A tabela sugerida (para van) vem de uma
  pesquisa de mercado descrita em `app/services/regions.py` e o gestor edita tudo.
- Peso por rota: ao iniciar (ou recalcular) a rota, as entregas ficam ligadas a ela (`deliveries.run_id`) e o peso
  carregado é guardado em `delivery_runs.load_kg`. O peso do caminhão (`on_board` em cada entrega) é só o que ainda está
  nele: o entregue sai na hora e o não recebido sai quando a rota é encerrada na base. Rotas de antes disso são
  preenchidas uma vez ao iniciar o servidor.
- Rotina do motorista em volta da rota: checklist de saída (`/api/checklists`, ligado à rota que sai em seguida; o
  gestor é avisado das pendências), abastecimento com a foto do cupom (`/api/fuel-entries`, entra em Custos como gasto
  real e consumo real), despesas da rota com comprovante (`/api/expenses`; aprovada, vira um reembolso em Pagamentos) e
  comprovante de entrega com o nome, o documento e a assinatura de quem recebeu. Registros feitos sem sinal chegam
  depois com o mesmo `client_id` (não duplicam) e a hora em que foram feitos no celular.
- Notificações com o app fechado (Web Push, `/api/push`): a chave VAPID é criada sozinha em `VAPID_KEY_FILE`
  (padrão `backend/vapid_private.pem`, fora do git). Quem está com o app aberto recebe o aviso pela tela; os aparelhos
  de quem fechou recebem a notificação (carga nova, valor lançado ou pago, despesa para aprovar ou analisada,
  entrega feita e pendência de checklist).
- Caminho percorrido (`/api/tracking/trails`): pontos do dia por veículo (rastreador ou, sem ele, celular), km e a rota
  de entrega do dia com o traçado planejado e a situação de cada parada.
- Opções de desenvolvedor (`/api/dev/simulations`, só com `DEV_TOOLS=true`, o padrão): rastreador simulado por veículo.
  Um laço dentro da API (`app/services/simulator.py`, a cada `SIMULATOR_TICK_SECONDS`) grava posições com hodômetro ao
  longo do traçado da rota em andamento, para em cada entrega até o motorista registrar (ou confirma sozinho, com o
  "motorista automático"), volta para a base e avisa as telas pelo WebSocket. Ajustes: velocidade da simulação (até
  60x), velocidade média, tempo parado em cada entrega; ações: pausar, pular para a próxima entrega e recomeçar o teste.

**Frontend**
- Tela de login (gestor ou motorista).
- Painel com indicadores, mapa ao vivo (Leaflet + OpenStreetMap) com ícone por veículo na cor do status, e lista de
  veículos: clicar centraliza o mapa no veículo; os que ainda não mandaram posição têm "Verificar rastreador".
  O mapa tem dois modos: "Só motoristas" (a posição de cada um) e "Caminho percorrido" (o trajeto do dia de cada
  motorista, a rota planejada e as paradas coloridas pela situação).
- Botão "Opções de dev" no menu (gestor e motorista, só em desenvolvimento ou com `VITE_DEV_TOOLS=true`): liga e
  desliga o rastreador simulado e ajusta o tempo do fluxo para testar a rota do início ao fim.
- Configurações → Rastreadores: conectar a Sascar com o usuário e a senha de integrador do SasIntegra e ver os veículos
  liberados, com aviso quando a placa difere da cadastrada.
- Rotas por motorista com filtros e trajeto no mapa, dividido em viagens a partir da base (saída, volta e km de cada uma).
- Configurações: base da empresa com busca de endereço, ponto marcado no mapa e raio.
- Campos de cidade e endereço com sugestões enquanto digita (nova entrega e base da empresa): a cidade vem com a UF,
  a rua é buscada na cidade escolhida e um CEP digitado no endereço preenche rua e cidade. Continua aceitando texto livre.
- Chat em tempo real: todos os motoristas na lista, busca por nome (sem precisar de acento), grupos com
  escolha de participantes e edição, não lidas na lista e no menu, separadores de dia e Enter para enviar.
- Motoristas: lista com CNH e veículo, e cadastro completo (dados, CNH, veículo e senha de acesso ao app).
  Botão "Remover" com confirmação do que muda, e a lista de motoristas removidos com "Reativar" (escolhendo um veículo
  livre e uma senha nova) ou "Excluir de vez" (pede para digitar o nome, porque não dá para desfazer).
  A placa do veículo abre a edição dele na tela de Veículos.
- Carregamento: fila de entregas do dia; o gestor marca as entregas e coloca no caminhão de um motorista,
  com conferência do peso pela capacidade do veículo. As rotas já encerradas no dia ficam recolhidas em cada caminhão.
- Motorista, em duas telas (uma rota por vez, podendo fazer várias no mesmo dia):
  "Minha rota" mostra a rota em andamento ou, sem ela, a próxima rota (o que está no caminhão agora, peso, valor
  previsto pela região e "Iniciar rota"), as próximas cargas e as rotas encerradas hoje. "Rotas feitas" mostra cada
  rota num cartão (Rota 1, 2… do dia) com km, peso, região, as entregas com as fotos dos comprovantes, o valor e se
  está a receber ou recebido, "Ver no mapa" e, no topo, quanto tem a receber e o que recebeu no período
  (`/api/delivery-runs/history`). O aviso "Você recebeu um carregamento" leva para "Minha rota". "Meu veículo"
  permite cadastrar o veículo ou completar o que falta e mostra os pneus.
- Rota em andamento (motorista): "Iniciar rota" em Minha rota abre o mapa com as paradas na ordem calculada,
  o traçado pelas ruas, por onde o caminhão já passou, km rodados, desgaste estimado dos pneus e um atalho para navegar
  até cada parada no Google Maps. O gestor vê no carregamento quem está em rota e quantos km já rodou.
- Pausas (motorista): refeição (com contagem da 1 h mínima), descanso e espera; aviso de direção contínua perto de 5h30.
- Comprovante: ao chegar perto do endereço aparece "Você chegou" com "Entregue" e "Não recebeu", ambos com foto
  (comprimida no celular). O gestor recebe um aviso em qualquer tela e vê foto, hora, motivo e local no carregamento.
- Veículos (gestor): lista com motorista, rastreador, combustível, pneus e sinal; edição, troca de motorista e exclusão
  com confirmação (pede a placa quando há histórico). A aba "Pneus" fica dentro da tela de Veículos.
- Pneus nos dois perfis: diagrama do desgaste por posição conforme o rodado (até 50% bom, 50–75% rodízio, acima de 75%
  trocar), ficha com sulco em mm e previsão de rodízio/troca, histórico e a simulação "+5 mil a +40 mil km". O gestor
  cadastra, mede, faz rodízio e recapagem (aba "Pneus" em Veículos); o motorista acompanha em "Meu veículo".
- Pagamentos (gestor): aba "Preço por região" para editar a tabela (nome, até quantos km da base, cidades que sempre
  entram, preço da rota e "Restaurar sugestão"), com atalho em Configurações. O carregamento mostra
  a rota prevista e o preço; o motorista vê o valor em Minha rota e a tabela em "Rotas feitas".
- Motorista, na rota: "Iniciar rota" abre o checklist do veículo; "Abastecer" e "Despesa" com foto; "Avisar cliente"
  abre o WhatsApp do cliente com a mensagem pronta e o tempo estimado; "Entregue" pede o nome de quem recebeu e a
  assinatura na tela. Sem sinal, entregas, abastecimentos e despesas ficam guardados no celular (aviso "aguardando
  envio") e vão sozinhos quando o sinal volta.
- App instalável (PWA): ícone na tela inicial, abre sem sinal na última versão carregada e recebe notificações com o
  app fechado ("Avisos no celular" em Minha rota e, para o gestor, em Configurações).
- Gestor: selo do checklist em cada caminhão do Carregamento (com as fotos), "Despesas para aprovar" em Pagamentos,
  gasto real e consumo real de combustível em Custos (com alerta de consumo fora do normal) e a lista de abastecimentos
  com o cupom. Nova entrega com o WhatsApp do cliente.
- Pagamentos (gestor): saldo por motorista (a pagar, pago no período, rotas sem valor e "Pagar tudo"), rotas do período
  com região, km, peso carregado/entregue, entregas e o valor pela tabela (com "Lançar" para a rota encerrada sem entregas
  registradas) e a lista de lançamentos com marcar como pago e desfazer pagamento.
- Custos da frota (gestor): total do período, divisão combustível × pneus, custo por km por veículo (▲ acima da média),
  preço da ANP com opção de informar o próprio, e combustível/consumo do veículo editável na tabela.
- Tema com os tokens do design system usado no protótipo (`src/styles/theme.ts`).

## Próximos passos sugeridos

1. Validar a integração da Sascar com credenciais reais de integrador e implementar a da Onixsat (manual do fornecedor).
2. Migrações de banco com Alembic antes de ir para produção (hoje as tabelas são criadas automaticamente).
3. Edição dos dados do motorista (nome, CNH, telefone) pelo gestor.
4. Módulos da fase 2: jornada completa (Lei 13.103: 8 h/dia, 11 h entre jornadas, relatórios para o RH), checklist de
   saída com fotos, abastecimentos (hodômetro × abastecimento), manutenção e pedágios no custo.
5. Alertas e cercas eletrônicas, nota de condução, multas e documentos (ver o plano do produto).
6. App mobile do motorista (React Native ou Flutter) consumindo esta mesma API, com GPS em segundo plano.

## Pontos de atenção

- Sem migrações ainda: ao iniciar, o backend cria sozinho as colunas novas que aceitam nulo (`app/db/upgrade.py`).
  Mudanças maiores (coluna obrigatória, renomear) ainda exigem apagar `backend/frotagest.db` ou adotar o Alembic.
- A busca de endereço usa o Nominatim (OpenStreetMap), que só permite uso leve. Em produção, troque por um geocodificador pago.
- A otimização da rota usa o servidor público de demonstração do OSRM (sem garantia de disponibilidade). Se ele não
  responder, a ordem é aproximada pela parada mais próxima em linha reta e a tela avisa. Em produção, suba um OSRM
  próprio ou use um serviço pago (Mapbox, Google Routes, OpenRouteService).
- Fotos dos comprovantes ficam no disco (`UPLOAD_DIR`, padrão `backend/uploads`). No Docker, monte um volume nessa pasta;
  em produção, prefira um armazenamento de objetos (S3 ou similar).
- O preço da ANP vem da planilha semanal publicada no site da agência; se o formato mudar, a busca falha e a tela pede
  o preço manual.
- O GPS do celular no navegador só funciona em HTTPS (ou localhost) e com a tela do app aberta. Ele só conta os km
  quando o veículo não manda posições pelo rastreador.
- ViaCEP e IBGE são gratuitos e sem chave, mas o ViaCEP bloqueia quem abusa. As buscas esperam 300 ms sem digitação
  e ficam em cache; com muito volume, considere uma base de CEPs própria.
- A tabela de preço por região é uma sugestão de mercado para van (2025–2026): revise os valores para a sua operação.
  As faixas usam a distância em linha reta da base; sem a base definida, só as cidades listadas encaixam a rota.
- Notificações, GPS e o service worker só funcionam em HTTPS (ou `localhost`). No celular pela rede local
  (`http://IP:5173`) eles ficam desligados: para testar no celular, publique com HTTPS (ou use um túnel HTTPS).
  O Chrome em modo anônimo não aceita notificações.
- Não troque o arquivo da chave VAPID depois de ter aparelhos inscritos: eles deixariam de receber as notificações.
- Troque `JWT_SECRET` no `.env` antes de qualquer uso real.
- Em produção, desligue as opções de desenvolvedor (`DEV_TOOLS=false`): qualquer usuário logado consegue ligar o
  rastreador simulado e "Recomeçar o teste" apaga as rotas do dia do veículo e os comprovantes das entregas de hoje.
  Com o simulador ligado, as posições do veículo vêm dele (o coletor pula esse veículo) e o GPS do celular não conta.
- Credenciais dos rastreadores ficam em `companies.tracker_credentials`; em produção, guarde-as criptografadas.
- Sascar (manual SasIntegra): só 1 consulta de posições por vez por integradora (as simultâneas são recusadas),
  `obterPacotePosicoes` é uma fila de até 3.000 pacotes que cobre D-1 e o dia atual, e o hodômetro não tem unidade
  documentada (os km saem dos pontos). `SASCAR_URL` permite apontar para o ambiente de homologação.
- O chat usa conexões em memória; com mais de um servidor, troque o `ChatHub` por Redis Pub/Sub.
- Localização de motorista é dado pessoal (LGPD): informe os motoristas e restrinja o acesso por perfil.
