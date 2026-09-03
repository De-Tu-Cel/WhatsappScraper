#!/usr/bin/env bash
# Prueba de webhooks Evolution API (local).
# Ejecutar: bash test_webhook.sh [http://localhost:8000]
# En prod (con cuidado): bash test_webhook.sh https://dashboard-wa.detucel.com

BASE="${1:-http://localhost:8000}"
API="$BASE/api"

GREEN='\033[92m'; RED='\033[91m'; BOLD='\033[1m'; RESET='\033[0m'

pass() { echo -e "${GREEN}✓${RESET}  $1"; }
fail() { echo -e "${RED}✗${RESET}  $1"; }
title() { echo -e "\n${BOLD}$1${RESET}"; }

# ─── 1. Mensaje entrante (inbound) ──────────────────────────────────────────
title "1. messages.upsert — inbound (de cliente)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API/evolution/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "evo-test",
    "data": [{
      "key": {
        "remoteJid": "5214421000001@s.whatsapp.net",
        "fromMe": false,
        "id": "TEST_INBOUND_001"
      },
      "pushName": "Cliente Prueba",
      "message": { "conversation": "Hola, me interesa su servicio de gas LP" },
      "messageType": "conversation",
      "messageTimestamp": '"$(date +%s)"'
    }]
  }')
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | head -n -1)
if [ "$CODE" = "200" ]; then
  pass "HTTP $CODE — inbound guardado"
  echo "   $BODY"
else
  fail "HTTP $CODE — revisar logs"
  echo "   $BODY"
fi

# ─── 2. Mensaje fromMe (saliente confirmado por Evolution) ──────────────────
title "2. messages.upsert — fromMe (salida desde instancia)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API/evolution/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "evo-test",
    "data": [{
      "key": {
        "remoteJid": "5214421000001@s.whatsapp.net",
        "fromMe": true,
        "id": "TEST_OUTBOUND_001"
      },
      "message": { "conversation": "Hola, somos Gas Detucel. En que le podemos ayudar?" },
      "messageType": "conversation",
      "messageTimestamp": '"$(date +%s)"'
    }]
  }')
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | head -n -1)
if [ "$CODE" = "200" ]; then
  pass "HTTP $CODE — outbound procesado"
  echo "   $BODY"
else
  fail "HTTP $CODE"
  echo "   $BODY"
fi

# ─── 3. ACK de entrega ──────────────────────────────────────────────────────
title "3. messages.update — delivery ACK (DELIVERED)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API/evolution/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.update",
    "instance": "evo-test",
    "data": [{
      "key": {
        "remoteJid": "5214421000001@s.whatsapp.net",
        "fromMe": true,
        "id": "TEST_OUTBOUND_001"
      },
      "update": { "status": "DELIVERED" }
    }]
  }')
CODE=$(echo "$RES" | tail -1)
if [ "$CODE" = "200" ]; then pass "HTTP $CODE — status DELIVERED actualizado"
else fail "HTTP $CODE"; fi

# ─── 4. ACK de lectura ──────────────────────────────────────────────────────
title "4. messages.update — delivery ACK (READ)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API/evolution/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.update",
    "instance": "evo-test",
    "data": [{
      "key": {
        "remoteJid": "5214421000001@s.whatsapp.net",
        "fromMe": true,
        "id": "TEST_OUTBOUND_001"
      },
      "update": { "status": "READ" }
    }]
  }')
CODE=$(echo "$RES" | tail -1)
if [ "$CODE" = "200" ]; then pass "HTTP $CODE — status READ actualizado"
else fail "HTTP $CODE"; fi

# ─── 5. connection.update — número de instancia ─────────────────────────────
title "5. connection.update — guarda número de la instancia"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API/evolution/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "connection.update",
    "instance": "evo-test",
    "data": {
      "state": "open",
      "instance": { "profileName": "Gas Detucel Test" },
      "me": { "id": "5214421999999@s.whatsapp.net", "name": "Gas Detucel Test" }
    }
  }')
CODE=$(echo "$RES" | tail -1)
if [ "$CODE" = "200" ]; then pass "HTTP $CODE — instancia conectada, número guardado"
else fail "HTTP $CODE"; fi

echo -e "\n${BOLD}─── Verificar en MongoDB ───${RESET}"
echo "  message_logs → filtrar direction='inbound', instance_name='evo-test'"
echo "  message_logs → filtrar message_id='TEST_OUTBOUND_001', ver status=READ"
echo "  instances    → filtrar name='evo-test', ver campo 'number'"
