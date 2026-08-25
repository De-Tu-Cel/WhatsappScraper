'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SpeedIcon from '@mui/icons-material/Speed'
import ForwardToInboxIcon from '@mui/icons-material/ForwardToInbox'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import BlockIcon from '@mui/icons-material/Block'
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend'
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined'
import DevicesOtherIcon from '@mui/icons-material/DevicesOther'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import ForumIcon from '@mui/icons-material/Forum'
import ArticleIcon from '@mui/icons-material/Article'
import InsightsIcon from '@mui/icons-material/Insights'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import { useLang } from '../context/LangContext'

// ─── FAQ data ────────────────────────────────────────────────────────────────
const FAQ = {
  en: [
    {
      key: 'cap',
      icon: SpeedIcon,
      cat: 'Daily cap',
      items: [
        {
          q: 'What is the daily cap?',
          a: 'Each WhatsApp instance can only send a limited number of messages per day. The cap resets every day at 00:00 UTC. "Total available" = total cap − messages already sent − already scheduled sends.',
        },
        {
          q: 'What is warmup mode?',
          a: 'A new number needs to be "warmed up" gradually to avoid being flagged as spam. In warmup mode the daily cap is much lower (e.g. 20–50 msgs/day). As the account ages and builds engagement, the cap grows. Never push a warm-up number to its limit on day one.',
        },
        {
          q: 'When does the counter reset?',
          a: "Once per calendar day, based on the app's configured timezone (Mexico City by default) — not necessarily midnight UTC. Scheduled sends count against the cap of the day they are set to run, not when they were created.",
        },
        {
          q: "What's the difference between the daily cap and the 'new contacts' limit?",
          a: "The daily cap limits how many distinct numbers an instance can message per day — messaging the same number again that day doesn't use extra cap. On top of that there's a smaller daily limit just for starting brand-new conversations for the first time, so the number doesn't look like it's mass-adding strangers. Both are shown together in the instance's cap badge.",
        },
        {
          q: 'What happens if a scheduled send runs out of cap?',
          a: "If an instance's daily cap (or its new-contacts limit) is already used up when a scheduled campaign runs, that recipient is skipped automatically and isn't retried later that day. It shows up as skipped in the batch-complete notification, and you get a one-time cap-reached alert for that instance.",
        },
      ],
    },
    {
      key: 'bulk',
      icon: ForwardToInboxIcon,
      cat: 'Bulk sending',
      items: [
        {
          q: 'Why do I need at least 3 templates?',
          a: "WhatsApp's anti-spam filters detect identical messages sent to many numbers. By rotating 3+ variants, each recipient receives a slightly different message — this dramatically reduces the risk of the account being flagged.",
        },
        {
          q: 'What is template rotation?',
          a: 'With multiple variants, the system distributes them in round-robin order. If you have 3 variants and 9 recipients: 1, 2, 3, 1, 2, 3, 1, 2, 3. Each variant should convey the same intent but with different wording.',
        },
        {
          q: 'How often can I contact the same company?',
          a: 'The system marks each company as "already contacted" after the first send. There is no hard cooldown, but best practice is to wait at least 7 days before following up.',
        },
        {
          q: 'Why are there pauses between messages?',
          a: 'Sending too fast looks like a bot and triggers WhatsApp bans. The send config lets you set a delay (recommended: 8–20 seconds). Batch mode groups sends with longer breaks between groups to mimic human behavior.',
        },
        {
          q: 'What do the delay/batch/break settings in Send Config mean?',
          a: "Delay is the pause between individual messages. Batch size is how many messages go out before a forced longer pause. Batch break is how long that pause lasts. The panel shows a live risk badge — low, medium or high — based on how aggressive your settings are; short delays, big batches or short breaks push it to 'high risk'. These same settings drive both live sends and scheduled campaigns.",
        },
      ],
    },
    {
      key: 'numbers',
      icon: PhoneAndroidIcon,
      cat: 'WA numbers',
      items: [
        {
          q: 'Why only one message per company?',
          a: "By default the system sends to the primary number only. You can expand the company chip in the selector to activate extra numbers, but sending to multiple contacts at the same company at once can seem aggressive.",
        },
        {
          q: 'What is company deduplication?',
          a: "Several URLs from the same domain resolve to the same company record. The system merges them so you don't send duplicates to the same business. The dedup key is the company_id, not the URL.",
        },
        {
          q: 'How do I protect my numbers from being banned?',
          a: '• Never send more than 50–80 messages/day on a new number.\n• Use template rotation (3+ variants).\n• Keep pauses of 8–20 s between messages.\n• Avoid links in early messages.\n• Keep your WhatsApp profile complete (photo, description, business category).\n• Respond to replies — genuine engagement is the best signal.',
        },
        {
          q: "What does the 'ACK' warning on an instance mean?",
          a: "Messages are going out but WhatsApp isn't confirming delivery back to the app — a different problem than being disconnected (the session is technically online, but delivery receipts aren't arriving). Treat it as a warning sign for that number and check it manually.",
        },
        {
          q: 'Why do I see different connect flows for different numbers (QR vs. code)?',
          a: 'It depends on the provider behind that instance. wwebjs, WAHA and Wasender connect by scanning a QR code that refreshes automatically. Evolution (the default/legacy provider) instead shows a pairing code you type into WhatsApp, which expires and regenerates on a countdown.',
        },
      ],
    },
    {
      key: 'scraping',
      icon: TravelExploreIcon,
      cat: 'Scraping',
      items: [
        {
          q: 'What does the scraper do?',
          a: 'Given a website URL, it visits the page and extracts: company name, industry, WhatsApp numbers, emails, address, business hours, social media links, and key contacts. Data is used to personalize messages ({{nombre}}, {{ciudad}}, {{industria}}).',
        },
        {
          q: 'Why do some companies have no WhatsApp?',
          a: "Not all businesses publish their WhatsApp number on their website. The scraper only finds what's publicly available. You can manually add a number in Database → Edit.",
        },
        {
          q: 'How often should I re-scrape?',
          a: 'Businesses update contact info 2–4 times per year on average. Re-scraping every 30–60 days keeps data fresh. Use Database → Actions → Re-scrape to update selected rows in bulk.',
        },
        {
          q: 'Can I bulk-upload URLs instead of pasting them one by one?',
          a: "Yes — use the CSV import (accepts .csv, .xlsx or .xls, up to 5 MB and 50 URLs per file). It auto-detects whichever column contains web addresses, ignores the rest, drops invalid or duplicate URLs automatically, and gives you a downloadable template if you're not sure of the format.",
        },
        {
          q: 'Can I add a company manually without scraping it?',
          a: 'Yes, from Database → Add company. You fill in the fields yourself (name, industry, city, website, WhatsApp numbers, etc.) instead of the scraper extracting them from a website.',
        },
      ],
    },
    {
      key: 'ai',
      icon: SmartToyIcon,
      cat: 'AI Chat',
      items: [
        {
          q: 'What does AI Chat do?',
          a: 'When a prospect replies to your outreach message, AI Chat can continue the conversation automatically. It maintains context from the history and follows the personality/script you configure in Settings → AI Config.',
        },
        {
          q: 'How is it activated per conversation?',
          a: 'Open the Conversations tab, click on a chat, and toggle the AI switch in the header. When active, a purple indicator appears next to the company name.',
        },
        {
          q: 'Does AI Chat respond immediately?',
          a: 'No. By default it waits a few seconds to simulate a human reading the message before responding. You can tune this delay and response style in Settings → AI Config.',
        },
        {
          q: 'What does the AI health banner in Conversations mean?',
          a: "It warns you when automatic AI follow-ups are paused for a reason — for example a safety circuit-breaker tripped after repeated errors, or it's outside the configured business hours. It's a diagnostic, not necessarily an urgent error, but it explains why AI didn't reply when you expected it to.",
        },
      ],
    },
    {
      key: 'blacklist',
      icon: BlockIcon,
      cat: 'Blacklist',
      items: [
        {
          q: 'What is the blacklist?',
          a: 'A list of domains you never want to contact — competitors, your own company, partners, already-signed clients, etc. Any URL or number matching a blacklisted domain is skipped automatically during scraping and sending.',
        },
        {
          q: 'How do I add a domain?',
          a: 'Go to the Blacklist section in the sidebar. Enter the domain (e.g. "competitor.com") and optionally a reason. You can also bulk-import from CSV. Blocked entries show a 🚫 badge in Database and Batch results.',
        },
        {
          q: 'Does blacklisting a domain affect companies I already scraped?',
          a: 'Yes — matching companies get flagged with a 🚫 badge wherever they appear (Database, batch results) and are skipped by future scraping and sending, even if they were already in your database before you blacklisted the domain.',
        },
      ],
    },
    {
      key: 'schedule',
      icon: ScheduleSendIcon,
      cat: 'Scheduled',
      items: [
        {
          q: 'How do scheduled sends work?',
          a: "A scheduled send is a campaign you configure now but runs at a future date and time. The server executes it automatically on the scheduled day — you don't need to be logged in.",
        },
        {
          q: 'Can I edit a scheduled send after creating it?',
          a: 'Yes, as long as its status is "pending". Click the campaign in the calendar view, then Edit. Once it starts running ("running" status) it can only be cancelled.',
        },
        {
          q: 'What happens if no WhatsApp number is connected when a scheduled send is due?',
          a: "The job doesn't fail — it's deferred and automatically retried every 5 minutes until at least one instance is connected again.",
        },
      ],
    },
    {
      key: 'instances',
      icon: DevicesOtherIcon,
      cat: 'Instances',
      items: [
        {
          q: "What does 'warmup mode' do to an instance, exactly?",
          a: "It lowers that instance's daily cap and its new-contacts limit so a young number ramps up gradually instead of being pushed hard from day one. Toggle it per instance in the Instances panel; the cap badge updates immediately everywhere it's shown.",
        },
        {
          q: 'How many WhatsApp numbers can each user have?',
          a: "Each user has 5 instance slots. Instances not assigned to anyone show up under 'Unassigned' in the sidebar, and can be assigned to a user one at a time or in bulk — if you select more instances than a user has free slots, the assignment splits automatically.",
        },
        {
          q: 'How does round-robin work between my numbers?',
          a: "Once you have 2 or more connected instances, a 'Rotation active' chip appears and new outbound conversations rotate between your connected numbers instead of always using the same one. Once a company is tied to a specific number, replies keep going through that same number.",
        },
        {
          q: 'What do the different disconnect reasons mean (banned, logged out, conflict...)?',
          a: 'The sidebar shows a specific reason when a number is offline: banned by WhatsApp, logged out from the phone, a device conflict, a multi-device conflict, an internal server error, a required restart, a session that got replaced, a timeout, or a normal closed connection. Each needs a different fix — a ban is permanent for that number, while a timeout or closed connection usually just needs reconnecting.',
        },
      ],
    },
    {
      key: 'notifications',
      icon: NotificationsActiveIcon,
      cat: 'Notifications',
      items: [
        {
          q: 'What kinds of notifications will I see?',
          a: 'Besides prospect replies, the system alerts you about: a batch finishing (sent/failed/skipped counts), an instance hitting its daily cap, and a reminder about an hour before a scheduled campaign fires.',
        },
        {
          q: "Why did I only get one 'cap reached' alert even though it stayed full all day?",
          a: "That alert is sent only once per instance per day on purpose, so it doesn't spam you every time you try to send after the cap is full. It clears automatically at the next reset.",
        },
        {
          q: 'If I clear all notifications, are they deleted?',
          a: "No — 'Clear all' just hides everything up to that moment for you, locally. The notifications still exist; anything new that arrives afterward shows up normally.",
        },
      ],
    },
    {
      key: 'conversations',
      icon: ForumIcon,
      cat: 'Inbox',
      items: [
        {
          q: 'Does the inbox update automatically, or do I need to refresh?',
          a: 'It refreshes itself — the conversation list and the open chat both check for updates automatically every 20 seconds, so new replies show up without reloading the page.',
        },
        {
          q: 'If a prospect replies, which of my numbers answers them?',
          a: "Always the same number that received their message, regardless of which one is 'assigned' generally or whichever is next in the rotation — this keeps the conversation consistent on their end.",
        },
        {
          q: "What's the 'my conversations only' filter?",
          a: 'It hides every thread except the ones sent from your own user account — useful when several people share the same database and instances.',
        },
        {
          q: 'Can I click the buttons/lists a prospect sent in a WhatsApp message?',
          a: "You can see them rendered in the thread, but clicking is just a read-only simulation for your reference — it doesn't actually re-send anything to WhatsApp. It's there so you can see exactly what the prospect saw and chose.",
        },
      ],
    },
    {
      key: 'templates',
      icon: ArticleIcon,
      cat: 'Templates',
      items: [
        {
          q: 'What do {{nombre}}, {{ciudad}}, {{industria}} and {{web}} do in a template?',
          a: "They're placeholders that get automatically replaced with each recipient's actual name, city, industry or website when the message is sent — so one template produces a personalized message per company.",
        },
        {
          q: "Why is a template grayed out and I can't select it?",
          a: 'It uses a variable (like {{ciudad}}) that none of your currently selected companies have data for. Pick a template without that variable, or fill in the missing field for those companies first.',
        },
        {
          q: 'Are templates shared with other users, or just mine?',
          a: "They're shared — the whole library is global across every user and reused on every bulk-send screen (Database, CSV import, Scheduled Sends), not tied to whoever created them.",
        },
      ],
    },
    {
      key: 'analytics',
      icon: InsightsIcon,
      cat: 'Analytics',
      items: [
        {
          q: 'What does the analytics screen actually measure?',
          a: 'It\'s a reply-quality table, not raw send counts: for every prospect that replied, it classifies the reply (human, automatic, bot, bot+AI, hybrid), scores its quality 1–5, and measures how fast they responded — with a summary bar showing the overall mix and average quality.',
        },
        {
          q: "What does 'send to Andy' do in analytics?",
          a: "It opens the AndyBotBuilder so you can turn that specific classified conversation into training material for the auto-reply bot. It's only available once the company has actually replied and been analyzed.",
        },
      ],
    },
    {
      key: 'admin',
      icon: AdminPanelSettingsIcon,
      cat: 'Users & roles',
      items: [
        {
          q: 'Who can create or manage other users?',
          a: "Only admins. The Admin panel lets an admin create users, reset a user's PIN, delete a user, and switch anyone else between admin and agent roles — except their own role, which is locked to prevent accidentally locking yourself out.",
        },
        {
          q: "What's the difference between an agent and an admin?",
          a: "Agents use the day-to-day features (scraping, sending, conversations) within their assigned instances. Admins additionally get the Admin panel to manage users, roles and PINs — regular agents can't see or access it at all.",
        },
      ],
    },
  ],
  es: [
    {
      key: 'cap',
      icon: SpeedIcon,
      cat: 'Límite diario',
      items: [
        {
          q: '¿Qué es el límite diario?',
          a: 'Cada instancia de WhatsApp solo puede enviar un número limitado de mensajes por día. El cupo se reinicia todos los días a las 00:00 UTC. "Disponibles" = cupo total − mensajes ya enviados − envíos ya programados para hoy.',
        },
        {
          q: '¿Qué es el modo warmup?',
          a: 'Un número nuevo necesita "calentarse" gradualmente para no ser detectado como spam. En modo warmup el cupo diario es mucho menor (ej. 20–50 msgs/día). Con el tiempo y la actividad orgánica el cupo crece. Nunca empujes un número en warmup a su límite desde el primer día.',
        },
        {
          q: '¿Cuándo se reinicia el contador?',
          a: 'Una vez por día calendario, según la zona horaria configurada en el sistema (Ciudad de México por defecto) — no necesariamente medianoche UTC. Los envíos programados cuentan contra el cupo del día en que están configurados, no del día en que se crearon.',
        },
        {
          q: "¿Cuál es la diferencia entre el cupo diario y el límite de 'contactos nuevos'?",
          a: 'El cupo diario limita cuántos números distintos puede contactar una instancia por día — reenviar al mismo número ese día no consume cupo extra. Además hay un límite más chico exclusivo para iniciar conversaciones con contactos totalmente nuevos por primera vez, para que el número no parezca que está agregando desconocidos en masa. Ambos se muestran juntos en el badge de cupo de la instancia.',
        },
        {
          q: '¿Qué pasa si un envío programado se topa con el cupo?',
          a: 'Si el cupo diario de una instancia (o su límite de contactos nuevos) ya se agotó cuando corre una campaña programada, ese destinatario se omite automáticamente y no se reintenta ese mismo día. Se refleja como omitido en la notificación de lote completado, y recibes una alerta de cupo agotado (una sola vez por instancia).',
        },
      ],
    },
    {
      key: 'bulk',
      icon: ForwardToInboxIcon,
      cat: 'Envíos masivos',
      items: [
        {
          q: '¿Por qué necesito al menos 3 plantillas?',
          a: 'Los filtros antispam de WhatsApp detectan mensajes idénticos enviados a muchos números. Al rotar 3+ variantes, cada destinatario recibe un texto ligeramente distinto — esto reduce drásticamente el riesgo de baneo.',
        },
        {
          q: '¿Qué es la rotación de plantillas?',
          a: 'Con múltiples variantes, el sistema las distribuye en round-robin. Si tienes 3 variantes y 9 destinatarios: 1, 2, 3, 1, 2, 3, 1, 2, 3. Cada variante debe transmitir la misma intención pero con redacción diferente.',
        },
        {
          q: '¿Con qué frecuencia puedo contactar a la misma empresa?',
          a: 'El sistema marca cada empresa como "ya contactada" después del primer envío. No hay un límite técnico, pero la buena práctica es esperar al menos 7 días antes de hacer seguimiento.',
        },
        {
          q: '¿Por qué hay pausas entre mensajes?',
          a: 'Enviar muy rápido parece un bot y activa el baneo. La configuración de envío permite definir el delay (recomendado: 8–20 s). El modo batch también agrupa envíos con pausas largas entre grupos para imitar comportamiento humano.',
        },
        {
          q: '¿Qué significan los ajustes de delay/lote/pausa en Config. de envío?',
          a: "El delay es la pausa entre cada mensaje individual. El tamaño de lote es cuántos mensajes salen antes de una pausa forzada más larga. La pausa entre lotes es cuánto dura esa pausa. El panel muestra un indicador de riesgo en vivo — bajo, medio o alto — según lo agresiva que sea tu configuración; delays cortos, lotes grandes o pausas cortas lo suben a 'riesgo alto'. Esta misma configuración la usan tanto los envíos en vivo como las campañas programadas.",
        },
      ],
    },
    {
      key: 'numbers',
      icon: PhoneAndroidIcon,
      cat: 'Números WA',
      items: [
        {
          q: '¿Por qué solo un mensaje por empresa?',
          a: 'Por defecto el sistema envía al número principal. Puedes expandir el chip de empresa en el selector para activar números extra, pero enviar a múltiples contactos de la misma empresa a la vez puede parecer agresivo.',
        },
        {
          q: '¿Qué es la deduplicación de empresas?',
          a: 'Varias URLs del mismo dominio resuelven al mismo registro de empresa. El sistema las fusiona para no enviar duplicados. La clave de dedup es el company_id, no la URL.',
        },
        {
          q: '¿Cómo protejo mis números de un baneo?',
          a: '• No más de 50–80 mensajes/día en un número nuevo.\n• Rotación de plantillas (3+ variantes).\n• Pausas de 8–20 s entre mensajes.\n• Evita links en los primeros mensajes.\n• Perfil de WhatsApp completo (foto, descripción, categoría).\n• Responde a las respuestas — la interacción genuina es la mejor señal.',
        },
        {
          q: "¿Qué significa la advertencia 'ACK' en una instancia?",
          a: 'Significa que los mensajes se están enviando pero WhatsApp no está confirmando la entrega de vuelta al sistema — es un problema distinto a estar desconectado (la sesión sigue en línea, pero no llegan los acuses de recibo). Trátalo como una señal de alerta para ese número y revísalo manualmente.',
        },
        {
          q: '¿Por qué veo distintas formas de conectar según el número (QR vs. código)?',
          a: 'Depende del proveedor detrás de esa instancia. wwebjs, WAHA y Wasender se conectan escaneando un código QR que se refresca solo. Evolution (el proveedor por defecto/legado) en cambio muestra un código de emparejamiento que se escribe en WhatsApp, y que expira y se regenera con una cuenta regresiva.',
        },
      ],
    },
    {
      key: 'scraping',
      icon: TravelExploreIcon,
      cat: 'Scraping',
      items: [
        {
          q: '¿Qué hace el scraper?',
          a: 'Dado el URL de un sitio web, extrae: nombre, giro, números de WhatsApp, correos, dirección, horarios, redes y contactos clave. Los datos personalizan los mensajes ({{nombre}}, {{ciudad}}, {{industria}}).',
        },
        {
          q: '¿Por qué algunas empresas no tienen WhatsApp?',
          a: 'No todos los negocios publican su número en el sitio web. El scraper solo encuentra lo que está públicamente disponible. Puedes agregar un número manualmente en Database → Editar.',
        },
        {
          q: '¿Cada cuánto hacer re-scraping?',
          a: 'Los negocios actualizan su info de contacto unas 2–4 veces al año. Hacer re-scraping cada 30–60 días mantiene los datos frescos. Usa Database → Acciones → Re-scraping para actualizar en lote.',
        },
        {
          q: '¿Puedo subir URLs en lote en vez de pegarlas una por una?',
          a: "Sí — usa la importación de CSV (acepta .csv, .xlsx o .xls, hasta 5 MB y 50 URLs por archivo). Detecta automáticamente la columna que contiene direcciones web, ignora el resto, descarta URLs inválidas o repetidas, y te da una plantilla descargable si no estás seguro del formato.",
        },
        {
          q: '¿Puedo agregar una empresa manualmente sin hacer scraping?',
          a: 'Sí, desde Database → Agregar empresa. Llenas los campos tú mismo (nombre, giro, ciudad, sitio web, números de WhatsApp, etc.) en lugar de que el scraper los extraiga de un sitio.',
        },
      ],
    },
    {
      key: 'ai',
      icon: SmartToyIcon,
      cat: 'Chat IA',
      items: [
        {
          q: '¿Qué hace el Chat IA?',
          a: 'Cuando un prospecto responde a tu mensaje, el Chat IA puede continuar la conversación automáticamente. Mantiene el contexto del historial y sigue la personalidad/guion que configures en Configuración → Config IA.',
        },
        {
          q: '¿Cómo se activa por conversación?',
          a: 'Abre la pestaña Conversaciones, haz clic en un chat y activa el interruptor de IA en el encabezado. Cuando está activo, aparece un indicador morado junto al nombre.',
        },
        {
          q: '¿El Chat IA responde de inmediato?',
          a: 'No. Por defecto espera unos segundos para simular que un humano leyó el mensaje. Puedes ajustar ese delay y el estilo en Configuración → Config IA.',
        },
        {
          q: '¿Qué significa el aviso de salud de IA en Conversaciones?',
          a: 'Te avisa cuando los seguimientos automáticos de IA están en pausa por alguna razón — por ejemplo un freno de seguridad que se activó tras varios errores seguidos, o estar fuera del horario laboral configurado. Es un diagnóstico, no necesariamente un error urgente, pero explica por qué la IA no respondió cuando lo esperabas.',
        },
      ],
    },
    {
      key: 'blacklist',
      icon: BlockIcon,
      cat: 'Blacklist',
      items: [
        {
          q: '¿Para qué sirve la blacklist?',
          a: 'Es una lista de dominios que nunca quieres contactar — competidores, tu propia empresa, socios, clientes ya cerrados. Cualquier URL o número que coincida se omite automáticamente durante el scraping y el envío.',
        },
        {
          q: '¿Cómo agrego un dominio?',
          a: 'Ve a la sección Blacklist en el menú lateral. Ingresa el dominio (ej. "competidor.com") y opcionalmente un motivo. También puedes importar desde CSV. Las entradas bloqueadas muestran un badge 🚫 en Database y Batch.',
        },
        {
          q: '¿Bloquear un dominio afecta a empresas que ya scrapeé antes?',
          a: 'Sí — las empresas que coinciden se marcan con un badge 🚫 donde aparezcan (Database, resultados de lote) y se omiten en futuros scraping y envíos, aunque ya estuvieran en tu base de datos antes de bloquear el dominio.',
        },
      ],
    },
    {
      key: 'schedule',
      icon: ScheduleSendIcon,
      cat: 'Programados',
      items: [
        {
          q: '¿Cómo funcionan los envíos programados?',
          a: 'Un envío programado es una campaña que configuras ahora pero se ejecuta en una fecha futura. El servidor lo ejecuta automáticamente — no necesitas estar conectado.',
        },
        {
          q: '¿Puedo editar un envío programado después de crearlo?',
          a: 'Sí, mientras su estado sea "pendiente". Haz clic en la campaña en la vista de calendario y luego en Editar. Una vez que inicia la ejecución (estado "en curso") solo se puede cancelar.',
        },
        {
          q: '¿Qué pasa si no hay ningún número de WhatsApp conectado cuando toca ejecutar un envío programado?',
          a: 'El trabajo no falla — se pospone y se reintenta automáticamente cada 5 minutos hasta que vuelva a haber al menos una instancia conectada.',
        },
      ],
    },
    {
      key: 'instances',
      icon: DevicesOtherIcon,
      cat: 'Instancias',
      items: [
        {
          q: "¿Qué le hace exactamente el 'modo warmup' a una instancia?",
          a: 'Reduce el cupo diario de esa instancia y su límite de contactos nuevos, para que un número joven suba de intensidad gradualmente en vez de forzarlo desde el primer día. Se activa por instancia en el panel de Instancias; el badge de cupo se actualiza al instante en todos lados donde se muestra.',
        },
        {
          q: '¿Cuántos números de WhatsApp puede tener cada usuario?',
          a: "Cada usuario tiene 5 espacios para instancias. Las instancias sin asignar aparecen bajo 'Sin asignar' en la barra lateral, y se pueden asignar a un usuario una por una o en lote — si seleccionas más instancias de las que le quedan libres a un usuario, la asignación se reparte automáticamente.",
        },
        {
          q: '¿Cómo funciona la rotación (round-robin) entre mis números?',
          a: "Cuando tienes 2 o más instancias conectadas, aparece un chip de 'Rotación activa' y las conversaciones salientes nuevas se reparten entre tus números conectados en vez de usar siempre el mismo. Una vez que una empresa queda ligada a un número específico, las respuestas siguen pasando por ese mismo número.",
        },
        {
          q: '¿Qué significan los distintos motivos de desconexión (banned, logged out, conflict...)?',
          a: 'La barra lateral muestra un motivo específico cuando un número no está conectado: banned (bloqueado por WhatsApp), logged out (cerró sesión desde el teléfono), conflict (conflicto de dispositivo), multidevice (conflicto de multi-dispositivo), server_error (error interno), restart (requiere reinicio), replaced (la sesión fue sustituida), timeout, o closed (cierre normal). Cada uno se resuelve distinto — un bloqueo es permanente para ese número, mientras que un timeout o cierre normal suele resolverse reconectando.',
        },
      ],
    },
    {
      key: 'notifications',
      icon: NotificationsActiveIcon,
      cat: 'Notificaciones',
      items: [
        {
          q: '¿Qué tipos de notificaciones voy a ver?',
          a: 'Además de respuestas de prospectos, el sistema avisa sobre: un lote que terminó (con conteo de enviados/fallidos/omitidos), una instancia que llegó a su cupo diario, y un recordatorio ~1 hora antes de que corra una campaña programada.',
        },
        {
          q: "¿Por qué solo me llegó una alerta de 'cupo agotado' aunque siguió lleno todo el día?",
          a: 'Esa alerta se envía a propósito una sola vez por instancia por día, para no llenarte de avisos cada vez que intentas enviar después de agotarse el cupo. Se limpia automáticamente en el siguiente reinicio.',
        },
        {
          q: '¿Al limpiar las notificaciones, se borran?',
          a: "No — 'Limpiar todo' solo oculta para ti, localmente, todo lo que había hasta ese momento. Las notificaciones siguen existiendo; cualquier cosa nueva que llegue después se mostrará con normalidad.",
        },
      ],
    },
    {
      key: 'conversations',
      icon: ForumIcon,
      cat: 'Bandeja',
      items: [
        {
          q: '¿La bandeja se actualiza sola o hay que refrescar?',
          a: 'Se actualiza sola — tanto la lista de conversaciones como el chat abierto revisan actualizaciones automáticamente cada 20 segundos, así que las respuestas nuevas aparecen sin recargar la página.',
        },
        {
          q: 'Si un prospecto responde, ¿cuál de mis números le contesta?',
          a: "Siempre el mismo número que recibió su mensaje, sin importar cuál esté 'asignado' en general o cuál siga en la rotación — esto mantiene la conversación consistente del lado del prospecto.",
        },
        {
          q: "¿Qué es el filtro de 'solo mis conversaciones'?",
          a: 'Oculta todos los hilos excepto los que enviaste desde tu propia cuenta, útil cuando varias personas comparten la misma base de datos e instancias.',
        },
        {
          q: '¿Puedo darle clic a los botones/listas que envió un prospecto en un mensaje de WhatsApp?',
          a: 'Se ven representados en el hilo, pero el clic es solo una simulación de solo lectura para tu referencia — no reenvía nada realmente a WhatsApp. Está ahí para que veas exactamente lo que el prospecto vio y eligió.',
        },
      ],
    },
    {
      key: 'templates',
      icon: ArticleIcon,
      cat: 'Plantillas',
      items: [
        {
          q: '¿Qué hacen {{nombre}}, {{ciudad}}, {{industria}} y {{web}} en una plantilla?',
          a: 'Son marcadores que se reemplazan automáticamente por el nombre, ciudad, giro o sitio web real de cada destinatario al momento de enviar — así una sola plantilla genera un mensaje personalizado por empresa.',
        },
        {
          q: '¿Por qué una plantilla aparece deshabilitada y no la puedo seleccionar?',
          a: 'Usa una variable (como {{ciudad}}) de la que ninguna de las empresas seleccionadas tiene dato. Elige una plantilla sin esa variable, o completa el campo faltante en esas empresas primero.',
        },
        {
          q: '¿Las plantillas son compartidas o solo mías?',
          a: 'Son compartidas — toda la biblioteca es global entre todos los usuarios y se reutiliza en todas las pantallas de envío masivo (Database, importar CSV, Programados), sin importar quién las creó.',
        },
      ],
    },
    {
      key: 'analytics',
      icon: InsightsIcon,
      cat: 'Analíticas',
      items: [
        {
          q: '¿Qué mide exactamente la pantalla de analíticas?',
          a: 'Es una tabla de calidad de respuestas, no un conteo de envíos: para cada prospecto que respondió, clasifica la respuesta (humana, automática, bot, bot+IA, híbrida), le da una calificación de calidad 1–5, y mide qué tan rápido respondió — con una barra resumen que muestra la mezcla general y la calidad promedio.',
        },
        {
          q: "¿Qué hace 'enviar a Andy' en analíticas?",
          a: 'Abre el AndyBotBuilder para convertir esa conversación clasificada en material de entrenamiento para el bot de respuesta automática. Solo está disponible una vez que la empresa realmente respondió y fue analizada.',
        },
      ],
    },
    {
      key: 'admin',
      icon: AdminPanelSettingsIcon,
      cat: 'Usuarios y roles',
      items: [
        {
          q: '¿Quién puede crear o administrar otros usuarios?',
          a: 'Solo los administradores. El panel de Admin permite crear usuarios, resetear el PIN de un usuario, eliminarlo, y cambiar el rol de cualquier otra persona entre admin y agente — excepto tu propio rol, que queda bloqueado para no quedarte fuera por accidente.',
        },
        {
          q: '¿Cuál es la diferencia entre un agente y un admin?',
          a: 'Los agentes usan las funciones del día a día (scraping, envíos, conversaciones) dentro de sus instancias asignadas. Los admins además tienen acceso al panel de Admin para gestionar usuarios, roles y PINs — los agentes normales no lo pueden ver ni acceder.',
        },
      ],
    },
  ],
}

// ─── Accordion item ───────────────────────────────────────────────────────────
function FaqItem({ q, a, index }) {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{
      borderRadius: 2,
      mb: 0.8,
      overflow: 'hidden',
      border: `1px solid ${open ? 'rgba(var(--accent-rgb,59,130,246),0.25)' : 'rgba(255,255,255,0.06)'}`,
      bgcolor: open ? 'rgba(var(--accent-rgb,59,130,246),0.04)' : 'rgba(255,255,255,0.025)',
      transition: 'border-color 0.18s, background 0.18s',
    }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 1, px: 1.4, py: 1.1, cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.1, flex: 1 }}>
          <Box sx={{
            mt: 0.2, flexShrink: 0, width: 17, height: 17, borderRadius: '50%',
            bgcolor: open ? 'rgba(var(--accent-rgb,59,130,246),0.22)' : 'rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.18s',
          }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: open ? 'var(--accent,#60a5fa)' : 'rgba(255,255,255,0.3)', lineHeight: 1 }}>
              {String(index + 1).padStart(2, '0')}
            </Typography>
          </Box>
          <Typography sx={{
            fontSize: '0.77rem', fontWeight: 600, lineHeight: 1.45,
            color: open ? 'var(--accent,#93c5fd)' : 'var(--text, #e2e8f0)',
            transition: 'color 0.15s',
          }}>
            {q}
          </Typography>
        </Box>
        <ExpandMoreIcon sx={{
          fontSize: 15, flexShrink: 0, mt: 0.25,
          color: open ? 'var(--accent,#60a5fa)' : 'rgba(255,255,255,0.28)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.22s, color 0.15s',
        }} />
      </Box>

      {open && (
        <Box sx={{
          px: 1.4, pb: 1.3, pt: 0.2,
          borderTop: '1px solid rgba(var(--accent-rgb,59,130,246),0.1)',
        }}>
          {a.split('\n').map((line, i) => {
            const isBullet = line.startsWith('•')
            return (
              <Typography key={i} sx={{
                fontSize: '0.73rem', color: 'rgba(255,255,255,0.55)',
                lineHeight: 1.65, mt: i > 0 ? (isBullet ? 0.25 : 0.5) : 0.7,
                pl: isBullet ? 1.6 : 0,
                position: 'relative',
              }}>
                {isBullet && (
                  <Box component="span" sx={{
                    position: 'absolute', left: 0.5, top: '0.15em',
                    color: 'rgba(var(--accent-rgb,59,130,246),0.55)', fontWeight: 700, fontSize: '0.7rem',
                  }}>›</Box>
                )}
                {isBullet ? line.slice(2) : line}
              </Typography>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

// ─── Rotating footer tips ──────────────────────────────────────────────────────
const TIPS = {
  en: [
    'Tip: rotate 3+ message variants to protect your numbers.',
    'Tip: keep 8–20s pauses between messages so you don’t look like a bot.',
    'Tip: ramp up a new number gradually in warmup mode — never push it to its limit on day one.',
    'Tip: respond to replies — genuine engagement is the best signal for WhatsApp.',
    'Tip: avoid links in your very first message to a new contact.',
    'Tip: re-scrape every 30–60 days to keep company data fresh.',
    'Tip: blacklist domains you never want to contact — it applies automatically everywhere.',
    'Tip: spread sends across your connected numbers instead of overloading just one.',
  ],
  es: [
    'Tip: rota 3+ variantes de mensaje para proteger tus números.',
    'Tip: mantén pausas de 8–20 s entre mensajes para no parecer un bot.',
    'Tip: sube de intensidad un número nuevo gradualmente en modo warmup — nunca lo lleves al límite el primer día.',
    'Tip: responde a las respuestas — la interacción genuina es la mejor señal para WhatsApp.',
    'Tip: evita links en tu primer mensaje a un contacto nuevo.',
    'Tip: haz re-scraping cada 30–60 días para mantener los datos frescos.',
    'Tip: bloquea dominios que nunca quieras contactar — se aplica automáticamente en todos lados.',
    'Tip: reparte tus envíos entre tus números conectados en vez de saturar solo uno.',
  ],
}
const TIP_INTERVAL_MS = 6000

// ─── Panel ────────────────────────────────────────────────────────────────────
export default function HelpPanel({ open, onClose }) {
  const { lang } = useLang()
  const faq = FAQ[lang] || FAQ.es
  const [activeCat, setActiveCat] = useState(0)
  const tips = TIPS[lang] || TIPS.es
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    setTipIndex(0)
    const id = setInterval(() => setTipIndex(i => (i + 1) % tips.length), TIP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [open, lang])

  return (
    <Box sx={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: open ? 'min(420px, 92%)' : 0,
      overflow: 'hidden',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      zIndex: 5,
    }}>
      {open && (
        <Box sx={{
          width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column', height: '100%',
          bgcolor: 'var(--card-bg, #161d2e)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
        }}>
          {/* ── Header ── */}
          <Box sx={{
            px: 2.2, py: 1.6, flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.13) 0%, rgba(var(--accent-rgb,59,130,246),0.04) 60%, transparent 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 2,
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.4), rgba(var(--accent-rgb,59,130,246),0.15))',
                border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(var(--accent-rgb,59,130,246),0.2)',
              }}>
                <HelpOutlinedIcon sx={{ fontSize: 17, color: 'var(--accent,#60a5fa)' }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text,#f1f5f9)', lineHeight: 1.2 }}>
                  {lang === 'en' ? 'Help & FAQ' : 'Ayuda y FAQ'}
                </Typography>
                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.32)', mt: 0.1 }}>
                  {faq[activeCat]?.cat}
                </Typography>
              </Box>
            </Box>
            <IconButton size="small" onClick={onClose} sx={{
              color: 'rgba(255,255,255,0.3)', width: 26, height: 26,
              '&:hover': { color: 'var(--text,#f1f5f9)', bgcolor: 'rgba(255,255,255,0.07)' },
            }}>
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>

          {/* ── Body: left nav + content ── */}
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Category nav */}
            <Box sx={{
              width: 80, flexShrink: 0,
              borderRight: '1px solid rgba(255,255,255,0.06)',
              py: 1, display: 'flex', flexDirection: 'column', gap: 0.3,
              overflowY: 'auto',
              scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
            }}>
              {faq.map((section, i) => {
                const Icon = section.icon
                const isActive = activeCat === i
                return (
                  <Tooltip key={i} title={section.cat} placement="right" arrow>
                    <Box
                      onClick={() => setActiveCat(i)}
                      sx={{
                        mx: 0.8, px: 0.5, py: 1, borderRadius: 2, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.55,
                        position: 'relative', overflow: 'visible',
                        bgcolor: isActive ? 'rgba(var(--accent-rgb,59,130,246),0.1)' : 'transparent',
                        transition: 'background 0.15s',
                        '&:hover': { bgcolor: isActive ? 'rgba(var(--accent-rgb,59,130,246),0.14)' : 'rgba(255,255,255,0.05)' },
                      }}
                    >
                      {isActive && (
                        <Box sx={{
                          position: 'absolute', left: -6.4, top: '18%', bottom: '18%',
                          width: 3, borderRadius: '0 3px 3px 0',
                          bgcolor: 'var(--accent,#60a5fa)',
                          boxShadow: '0 0 6px rgba(var(--accent-rgb,59,130,246),0.6)',
                        }} />
                      )}
                      <Icon sx={{
                        fontSize: 18,
                        color: isActive ? 'var(--accent,#60a5fa)' : 'rgba(255,255,255,0.3)',
                        transition: 'color 0.15s',
                      }} />
                      <Typography sx={{
                        fontSize: '0.53rem', fontWeight: isActive ? 700 : 500,
                        color: isActive ? 'var(--accent,#93c5fd)' : 'rgba(255,255,255,0.28)',
                        textAlign: 'center', lineHeight: 1.3,
                        transition: 'color 0.15s',
                      }}>
                        {section.cat}
                      </Typography>
                    </Box>
                  </Tooltip>
                )
              })}
            </Box>

            {/* FAQ items */}
            <Box sx={{
              flex: 1, overflowY: 'auto', px: 1.3, py: 1.3, minWidth: 0,
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.08) transparent',
              '&::-webkit-scrollbar': { width: 3 },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.08)', borderRadius: 2 },
            }}>
              {/* Section label */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, mb: 1.3 }}>
                {(() => { const Icon = faq[activeCat]?.icon; return Icon ? <Icon sx={{ fontSize: 14, color: 'var(--accent,#60a5fa)' }} /> : null })()}
                <Typography sx={{
                  fontSize: '0.68rem', fontWeight: 700,
                  color: 'rgba(var(--accent-rgb,59,130,246),0.8)',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                }}>
                  {faq[activeCat]?.cat}
                </Typography>
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)' }} />
              </Box>

              {(faq[activeCat]?.items || []).map((item, i) => (
                <FaqItem key={i} q={item.q} a={item.a} index={i} />
              ))}
            </Box>
          </Box>

          {/* ── Footer ── */}
          <Box sx={{
            px: 2, py: 0.9, flexShrink: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.03)',
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            <Box sx={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              bgcolor: 'var(--accent,#60a5fa)',
              boxShadow: '0 0 6px rgba(var(--accent-rgb,59,130,246),0.55)',
            }} />
            <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Typography key={tipIndex} sx={{
                fontSize: '0.64rem', color: 'rgba(255,255,255,0.28)', fontStyle: 'italic',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                '@keyframes tipSlideIn': {
                  '0%':   { transform: 'translateX(14px)', opacity: 0 },
                  '100%': { transform: 'translateX(0)', opacity: 1 },
                },
                animation: 'tipSlideIn 0.4s cubic-bezier(0.4,0,0.2,1)',
              }}>
                {tips[tipIndex]}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
