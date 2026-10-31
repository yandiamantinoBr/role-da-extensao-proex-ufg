# Composição do diagnóstico no assistente — revisão limitada

Fonte lida no root e confirmada idêntica à base `f6e71b9`: `components/portal/assistant-panel.tsx`. A implementação não foi alterada. **5/5 testes passaram em Node 24 e Node 26**, com lint sem erro/aviso: três novos de composição e dois existentes do painel.

O teste novo executa a TSX real do pai com respostas HTTP falsas. O componente filho é uma fronteira de ciclo de vida simulada; a reconciliação genérica por tipo/key registra montagem e descarte do estado local. Não há cópia da condição de autorização/revisão nem teste de regex/texto do código.

Provas: autorização atual + revisão salva só monta diagnóstico após abrir a configuração, dentro do fieldset; viewer e revisão zero não o montam; mudar a organização efetivamente carregada ou salvar nova revisão desmonta a fronteira anterior e reinicia seu consentimento local. O harness antigo recebeu somente mock do novo componente filho para corrigir o ENOENT da resolução `.ts` versus `.tsx`, preservando seus testes de troca de organização e credenciais.

Sem rede, provedor, chave real, servidor, porta 5173 ou edição de ReportsCenter. Esta composição virtual não substitui a reconciliação/navegação real; o CUA integrado foi conduzido separadamente pelo coordenador.