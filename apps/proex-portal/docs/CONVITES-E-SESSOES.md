# Convites e sessões no Portal PROEX

Em Equipes, abra **Pessoas e acessos → Convidar pessoa**. Escolha a função e o escopo. Ao gerar o convite, a tela mostra a validade no horário de Brasília e oferece **Copiar link**, **Mostrar QR code** e **Baixar QR code**. O envio é manual à pessoa convidada. Ela usa o link ou lê o QR pelo aparelho e conclui a ativação com uma senha. Para acesso temporário por ação, o fim definido pela equipe também limita a validade do convite.

O convite de equipe comum vale por até sete dias. A sessão por senha é renovada ao usar o Portal após 24 horas desde a última renovação e vence após sete dias sem renovação. Sair ou revogar a sessão encerra o acesso daquele login. A função e o projeto concedidos são verificados no servidor. Enquanto o link continuar válido, a aceitação pela mesma conta pode ser retomada com a senha correta e reaproveita o vínculo.

O link que aparece no cartão põe o código no fragmento. A rota antiga com consulta faz um redirecionamento temporário para esse formato antes do HTML. A prévia Open Graph usa texto e uma imagem institucional genérica desenhada no FigCraft. O navegador envia o código ao Portal no corpo do pedido de conferência, com verificação de origem. A conferência lê os dados do convite e a ativação usa a operação de conta existente.

O QR é um PNG criado no navegador com [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator), licenciado em MIT e sem dependências transitivas. O módulo é carregado ao abrir o QR. A imagem guarda o mesmo código do link, então deve ser enviada diretamente à pessoa convidada. O cartão recolhe as opções de compartilhar quando o convite é aceito, revogado ou vence.

Teste o fluxo com a bancada descartável descrita no repositório. A prova do link legado deve observar um 307, com `Cache-Control: private, no-store`, corpo vazio e destino relativo com fragmento. A prova do link novo deve confirmar o título e a imagem Open Graph no HTML genérico, abrir a ativação no navegador e comparar o endereço contido no PNG com o endereço exibido no cartão.
