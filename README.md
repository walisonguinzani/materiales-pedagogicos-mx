# Kit Sementes de Esperança · Landing page (Portugal)

Landing page em português de Portugal do **Kit Sementes de Esperança** (cartões interativos de evangelização para imprimir), com venda pela **Hotmart**. Preço: **16,90 €**, pagamento único.

A versão anterior para o México (espanhol, checkout SPEI via Zenith) está guardada no branch `mexico`.

## Estrutura
| Ficheiro | O que é |
|---|---|
| `index.html` | Landing page |
| `termos.html` · `privacidade.html` | Termos de Utilização · Política de Privacidade (Hotmart como vendedora, isenção da Meta, dados da empresa) |
| `assets/site.css` · `assets/fonts.css` | Estilos e fontes (Lora e Poppins, OFL, alojadas no site) |
| `assets/meta.js` | Píxel da Meta (opcional) e passagem dos UTMs para o checkout |
| `assets/img/` | Ilustrações e capas em português |

Site estático com uma única função no Vercel (`api/meta-event.js`) para a API de Conversões. Não precisa de build.

## Checkout
Todos os botões apontam para `https://pay.hotmart.com/M108302966L?checkoutMode=10`. Para trocar de link, substitui esse endereço no `index.html` (procura por `pay.hotmart.com`).

Os parâmetros da campanha que chegam à página (`utm_*`, `src`, `sck`, `fbclid`, `xcod`) são acrescentados automaticamente ao link da Hotmart, para a venda ficar atribuída ao anúncio.

O order bump (Acesso Vitalício + Atualizações) e o downsell são configurados só na Hotmart; a página não os menciona.

## Píxel da Meta e API de Conversões
- Píxel `1556039792956905`, definido em `<meta name="meta-pixel">` no `index.html`.
- A página envia `PageView`, `ViewContent` e `InitiateCheckout` (no clique em comprar) pelo navegador **e** pelo servidor (`/api/meta-event`), com o mesmo `event_id`, para a Meta não contar a dobrar.
- A compra (`Purchase`) é enviada pela Hotmart: configura o mesmo píxel e o token em Hotmart → Ferramentas → Pixel de rastreamento.

### Configurar o token no Vercel (uma vez)
1. No Gestor de Eventos da Meta: Definições do píxel → API de Conversões → **Gerar token de acesso**.
2. No Vercel: projeto → **Settings → Environment Variables** → adiciona `META_CAPI_TOKEN` com o token (ambiente *Production*).
3. Opcional, só para testar: `META_TEST_EVENT_CODE` com o código do separador "Testar eventos". **Apaga-o depois do teste**, senão os eventos não contam para as campanhas.
4. Faz **Redeploy** do projeto para as variáveis entrarem em vigor.
5. Confirma em `https://O_TEU_DOMINIO/api/health` (mostra só sim/não, nunca o token).

O token nunca vai no código nem no repositório.

## Testar em local
```bash
npm test                      # testes da API de Conversões
python3 -m http.server 8080   # página → http://localhost:8080 (sem a função /api)
```
