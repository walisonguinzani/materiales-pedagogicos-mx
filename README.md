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
| `assets/img/` | Ilustrações, capas em português e selo do Acesso Vitalício |

Site 100 % estático: não precisa de build nem de variáveis de ambiente.

## Checkout
Todos os botões apontam para `https://pay.hotmart.com/M108302966L`. Para trocar de link, substitui esse endereço no `index.html` (procura por `pay.hotmart.com`).

Os parâmetros da campanha que chegam à página (`utm_*`, `src`, `sck`, `fbclid`, `xcod`) são acrescentados automaticamente ao link da Hotmart, para a venda ficar atribuída ao anúncio.

O order bump (Acesso Vitalício + Atualizações) e o downsell são configurados na Hotmart; a página só menciona o order bump como opcional.

## Píxel da Meta (opcional)
Desligado por defeito. Para ligar, coloca o ID em `<meta name="meta-pixel" content="O_TEU_ID">` no `index.html`. A página envia `PageView`, `ViewContent` e `InitiateCheckout` (no clique). A compra (`Purchase`) é medida pela Hotmart: configura o mesmo píxel em Hotmart → Ferramentas → Pixel de rastreamento.

## Testar em local
```bash
python3 -m http.server 8080   # → http://localhost:8080
```
