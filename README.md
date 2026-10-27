# Sensores do Celular

App web que identifica o aparelho (marca e modelo), detecta quais sensores o navegador consegue ler,
coleta os sensores escolhidos e mostra tudo num dashboard.

- **Endereço:** https://wanderm.github.io/sensores-celular/
- **Dados:** Supabase (projeto HorseAI), tabelas `aparelhos` e `leituras`, protegidas por RLS: cada usuário só vê os próprios dados.
- **Login:** link mágico por e-mail.

Sensores suportados: acelerômetro, giroscópio, orientação/bússola, localização (GPS), bateria,
nível de som do microfone (só volume, sem gravar áudio), rede, luz ambiente e magnetômetro
(estes dois só onde o navegador libera).

A coleta só acontece com o app aberto e a tela ligada (limite dos navegadores).
