# Club Fortuna

Casino web cooperativo y multijugador con fichas ficticias. Armás una sala, invitás a tus amigos con un código de 4 letras y juegan juntos contra la casa.

**Fichas ficticias · Sin dinero real · Solo por diversión.**

## Juegos

- **Ruleta** europea (plenos, docenas, columnas, rojo/negro, par/impar, 1-18/19-36)
- **Blackjack** (pedir, plantarse, doblar; toda la mesa contra el crupier)
- **Tragamonedas** con pozo progresivo compartido por el equipo
- **Baccarat** (Punto, Banca, Empate)

## Lo cooperativo

- Las ganancias de todos suman a una meta de equipo con niveles; al subir de nivel cada jugador recibe un bono.
- Se pueden regalar fichas entre compañeros.
- Rescate de 500 fichas si te quedás en cero.
- Chat y novedades de la sala.

## Cómo correrlo

Necesitás Node.js 18 o más nuevo.

```bash
npm install
npm start
```

Abrí `http://localhost:3000`. Al arrancar, el servidor también muestra la dirección de tu red local para que entren quienes estén en el mismo Wi-Fi. Para jugar por internet usá un túnel (ngrok, cloudflared) o subilo a cualquier hosting de Node; respeta la variable `PORT`.

Para probar solo, abrí otra pestaña: cada pestaña es un jugador distinto.

## Publicarlo como página web

El repo incluye `render.yaml` para subirlo gratis a [Render](https://render.com):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/condezuzu/club-fortuna)

En el plan gratuito el servidor se duerme tras 15 minutos sin visitas (tarda cerca de un minuto en despertar) y las salas viven en memoria, así que se pierden cuando se duerme o se reinicia.

## Estructura

- `server/` — servidor HTTP + WebSocket. Decide todos los resultados; el navegador solo envía jugadas.
- `server/games/` — un archivo por juego. Los archivos nuevos se detectan solos.
- `public/` — cliente sin frameworks ni paso de compilación.
- `public/js/games/` — interfaz de cada juego (se registran en `public/js/main.js`).
- `test/` — tests del servidor y de la ruleta.

```bash
npm test
```
