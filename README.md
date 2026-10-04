# Club Fortuna

Casino web cooperativo y multijugador con fichas ficticias. Armás una sala, invitás a tus amigos con un código de 4 letras y juegan juntos contra la casa.

**Fichas ficticias · Sin dinero real · Solo por diversión.**

## Juegos

- **Ruleta** europea con rueda animada
- **Blackjack** (pedir, plantarse, doblar; toda la mesa contra el crupier)
- **Tragamonedas** con pozo progresivo compartido por el equipo
- **Baccarat** (Punto, Banca, Empate)
- **Póker de 3 cartas** contra el crupier

Cada juego tiene además su mesa **High Limit**, con apuestas mucho más altas, para quien tenga 10.000 fichas o más en la mano.

## Lo cooperativo

- **Cuota del equipo:** las ganancias de todos contra la casa suman a una cuota. Se ve cuánto aportó cada jugador, y al cumplirla el bono se reparte según ese aporte.
- Se pueden regalar fichas, pagar la deuda de un compañero o hacer llover fichas sobre todo el equipo.
- Emotes, y cosas para tirarle a los demás (o al crupier).
- Chat y novedades de la sala.

## Tu jugador

- **Se guarda solo** en el navegador: fichas, nivel, deuda, compras, historial y avatar vuelven la próxima vez que entres desde el mismo navegador, aunque el servidor se haya reiniciado.
- **Nivel personal** según lo que apostaste; sube tu límite con el prestamista.
- **Avatar** personalizable (piel, pelo, ropa) que camina por la parte de abajo de la pantalla, con sombreros, lentes, mascotas y auras para comprar.
- **Perfil** con estadísticas, pico de fichas e historial de las últimas jugadas. Tocá a cualquier jugador para ver el suyo.
- **Prestamista:** presta con 20% de interés y se queda con el 30% de cada ganancia hasta que pagues.
- **Rescate:** si te quedás en cero, hay que ganárselo repitiendo una secuencia de memoria.
- **Tienda:** títulos, paños de otros colores para tus mesas, emotes VIP, propinas para el crupier.

**Don Fortunato**, el crupier, está siempre en pantalla: comenta las jugadas, se burla cuando perdés y cuenta chistes de casino.

## Cómo correrlo

Necesitás Node.js 18 o más nuevo.

```bash
npm install
npm start
```

Abrí `http://localhost:3000`. Al arrancar, el servidor también muestra la dirección de tu red local para que entren quienes estén en el mismo Wi-Fi.

Para probar solo con dos jugadores en el mismo navegador, abrí una segunda pestaña en `http://localhost:3000/?p=2`: es un perfil independiente.

## Publicarlo como página web

El repo incluye `render.yaml` para subirlo gratis a [Render](https://render.com):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/condezuzu/club-fortuna)

En el plan gratuito el servidor se duerme tras 15 minutos sin visitas (tarda cerca de un minuto en despertar). Las salas viven en memoria y se pierden cuando se duerme o se reinicia; los jugadores no, porque su perfil está guardado en su navegador.

Los perfiles guardados van firmados para que nadie pueda editarse las fichas. En Render la firma usa una clave privada del servicio sin configurar nada; si definís la variable de entorno `CLUB_SECRET`, se usa esa. Corriendo en tu compu sin esa variable se usa una clave de desarrollo que figura en el código (`/healthz` informa `savesSecured: false`).

## Estructura

- `server/` — servidor HTTP + WebSocket. Decide todos los resultados; el navegador solo envía jugadas.
- `server/games/` — un archivo por juego; los `*_high.js` son las variantes High Limit. Los archivos nuevos se detectan solos.
- `server/economy.js` — niveles, préstamos y todo lo que se compra.
- `server/profile.js`, `server/saves.js` — el perfil persistente y su firma.
- `public/` — cliente sin frameworks ni paso de compilación.
- `public/js/games/` — interfaz de cada juego (se registran en `public/js/main.js`).
- `public/js/mascot.js`, `avatars.js`, `wheel.js` — Don Fortunato, los avatares y la rueda de la ruleta.
- `test/` — tests del servidor.

```bash
npm test
```
