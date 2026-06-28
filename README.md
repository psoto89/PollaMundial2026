# Gran Polla Mundial 2026

Web de consulta de la polla del Mundial 2026 entre amigos. Tabla de posiciones pública, detalle por participante, y vista EN VIVO que recalcula puntos en tiempo real partido por partido.

## Stack

- **Next.js 14** (App Router) + TypeScript estricto
- **Supabase** (Postgres + Realtime)
- **shadcn/ui** + Tailwind CSS (tema oscuro deportivo, acento lima `#9EE637`)
- **SheetJS** (`xlsx`) para el importador de pronósticos
- **Vitest** para tests de la lógica de scoring

---

## Setup rápido

### 1. Crear `.env.local`

```bash
cp .env.example .env.local
```

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de tu proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (segura para el cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo server-side) |
| `ADMIN_PASSWORD` | Contraseña para acceder a `/admin` |
| `ADMIN_SESSION_SECRET` | Cadena aleatoria ≥ 32 chars para firmar la cookie de sesión |

### 2. Aplicar el schema en Supabase

Copiar y ejecutar en el **SQL Editor** de tu proyecto Supabase:

```
supabase/migrations/001_initial_schema.sql
```

Luego habilitar **Realtime** para `matches` y `scores_cache`:
> Supabase Dashboard → Database → Replication → Source → marcar `matches` y `scores_cache`

### 3. Instalar y correr

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 4. Importar los pronósticos

1. Ir a `/admin/login` → ingresar `ADMIN_PASSWORD`
2. Ir a `/admin/import`
3. Subir `Gran_Polla_Mundial_2026.xlsx`
4. Revisar el preview (13 participantes, 72 partidos, 48 equipos)
5. Confirmar → todo se inserta vía upsert (re-importar es seguro)

---

## Tests

```bash
npm test          # vitest run — 34 tests del motor de scoring
npm run test:watch
```

---

## Reglas de puntuación

### Fase de grupos
- Acertar signo (1/X/2): **+2 pts**
- Además marcador exacto: **+3 pts adicionales** (total 5)

### Clasificados a dieciseisavos
- Equipo clasificado acertado (1º, 2º **o** mejor tercero): **+4 pts**
- Además posición exacta (1º=1º, 2º=2º, **3º=3º**): **+4 pts adicionales** (total 8)
- Si clasificó pero en otra posición (p. ej. lo pusiste 3º y quedó 2º, o lo pusiste 2º y quedó mejor tercero): **solo +4**

### Semifinales / puestos finales
- Equipo entre los 4 semifinalistas: **+10 pts**
- Puesto exacto: Campeón **+20**, Subcampeón **+15**, 3er **+12**, 4to **+10**

### Preguntas (6 en total)
- Cada acierto: **+7 pts**

### Premiación (informativo)
- 1er puesto: 60% del pozo · 2do puesto: 30% · Ganador fase de grupos: 10%

---

## Flujo Realtime — Arquitectura de resultados en vivo

La capa de resultados en vivo usa **webhooks push** (no polling). BallDontLie nos avisa cuando pasa algo, nosotros actualizamos Supabase, y Realtime propaga a todos los clientes en tiempo real.

```
BallDontLie detecta gol / inicio / fin de partido
  → POST /api/webhooks/live  (payload firmado con HMAC-SHA256)
  → Verificamos firma (X-BDL-Webhook-Signature)
  → Extraemos marcador + minuto + estado del payload
  → UPDATE matches en Supabase (last_source = 'webhook')
  → Supabase Realtime emite postgres_changes
  → Clientes suscritos reciben el evento sin recargar
  → Vista EN VIVO recalcula puntos con scoring.ts en el cliente
  → Al terminar el partido → recalc de scores_cache automático
```

**Fallback manual:** si BallDontLie no envía un evento o hay un conflicto, el admin puede editar el marcador desde `/admin/results`. Los updates manuales bloquean el webhook por 10 minutos (`last_source = 'manual'`).

### 3 modos del provider (env var `LIVE_PROVIDER`)

| Modo | Cuándo usar |
|---|---|
| `webhook` (default) | Producción con BallDontLie configurado |
| `manual` | Sin API / fallback siempre disponible |
| `poll` | Reconciliador — no implementado, placeholder |

---

## Setup de BallDontLie Webhooks

### 1. Crear cuenta y endpoint

1. Ir a [app.balldontlie.io](https://app.balldontlie.io) → Webhooks → **Create endpoint**
2. URL del endpoint: `https://tu-dominio.vercel.app/api/webhooks/live`
3. Suscribirse a eventos World Cup:
   - `worldcup.game.started`
   - `worldcup.game.ended`
   - `worldcup.team.goal`
   - `worldcup.game.halftime`
   - `worldcup.game.second_half_started`
   - `worldcup.game.extra_time`
4. Copiar el **Endpoint Secret** y ponerlo en `BALLDONTLIE_WEBHOOK_SECRET`

### 2. Mapear external_id en los partidos

Al importar el Excel en `/admin/import`, los partidos quedan en Supabase sin `external_id`. Para que los webhooks puedan resolverlos:

1. Buscar los IDs de los partidos en la API de BallDontLie (`GET /worldcup/games`)
2. Hacer un UPDATE en Supabase: `matches SET external_id = '{bdl_game_id}' WHERE match_index = {n}`
3. Una vez mapeados, los webhooks actualizarán los partidos correctamente

### 3. Probar localmente con ngrok

BallDontLie necesita una URL pública para enviar los webhooks. En local:

```bash
# Opción A: ngrok
ngrok http 3000
# → Copiar la URL pública: https://xxxx.ngrok-free.app

# Opción B: cloudflared (tunnel de Cloudflare, gratis)
cloudflare-warp tunnel --url localhost:3000

# Luego en BallDontLie dashboard:
# URL = https://xxxx.ngrok-free.app/api/webhooks/live
```

Para ver el payload real del primer evento y verificar `config/liveWebhookMap.ts`:

```bash
# Activar logging del payload en .env.local
LOG_WEBHOOK_PAYLOAD=true
```

Los logs aparecen en la consola de Next.js (local) o en Vercel → Runtime Logs (producción).

### 4. Verificar que funciona

```bash
# Enviar un evento de prueba desde el dashboard de BallDontLie
# O usar curl con una firma válida (ver test en src/app/api/webhooks/live/route.ts)

# Ver logs de Vercel en producción:
vercel logs --follow
```

---

## Migrabilidad a self-service (futuro)

El modelo no tiene `user_id` en `participants`. Para permitir que los participantes carguen sus propios pronósticos:

1. Agregar `user_id UUID REFERENCES auth.users(id) NULLABLE` en `participants`
2. Habilitar Supabase Auth (magic link o email/password)
3. Agregar RLS policies con `auth.uid() = user_id` para INSERT/UPDATE
4. Crear un formulario público en `/join`

No requiere rehacer predicciones ni scoring.

---

## Agregar el reconciliador poll (futuro)

El `pollProvider` en `src/lib/liveProvider.ts` es un placeholder. Para activarlo:

1. Setear `FOOTBALL_API_KEY` (API-Football u otro) en `.env.local`
2. Implementar `fetchLiveFromApi()` en `pollProvider.getLiveMatches()`
3. Activar con `LIVE_PROVIDER=poll` o `RECONCILE_LIVE=true`
4. El pollProvider respeta `last_source = 'manual'` igual que el webhook

---

## Deploy en Vercel

Conectar el repo en Vercel y agregar las 5 env vars del `.env.example`. Branch `main` → producción, `develop` → preview automático.
