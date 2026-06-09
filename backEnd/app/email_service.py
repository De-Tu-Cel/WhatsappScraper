import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def send_reset_email(to_email: str, display_name: str, token: str) -> bool:
    smtp_host = os.getenv("SMTP_HOST", "smtp.hostinger.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASSWORD", "")
    if not smtp_user or not smtp_pass:
        print("[Email] SMTP no configurado")
        return False

    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#0a0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">

  <!-- Card -->
  <div style="max-width:460px;margin:0 auto;background:#060f0c;border-radius:20px;overflow:hidden;border:1px solid rgba(21,87,245,0.25);box-shadow:0 24px 60px rgba(0,0,0,0.6)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0e2d5c 0%,#060f0c 100%);padding:28px 32px 24px;border-bottom:1px solid rgba(21,87,245,0.2)">
      <div style="display:inline-flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(21,87,245,0.12);border:1.5px solid rgba(21,87,245,0.45);display:inline-flex;align-items:flex-end;justify-content:center;gap:3px;padding:10px 11px 10px">
            <div style="width:6px;height:10px;border-radius:2px 2px 1px 1px;background:rgba(21,87,245,0.55)"></div>
            <div style="width:6px;height:15px;border-radius:2px 2px 1px 1px;background:rgba(21,87,245,0.8)"></div>
            <div style="width:6px;height:21px;border-radius:2px 2px 1px 1px;background:#1557f5"></div>
          </div>
        <div>
          <div style="color:#fff;font-size:17px;font-weight:800;letter-spacing:-0.02em;line-height:1.2">Lector Comercial</div>
          <div style="color:rgba(255,255,255,0.35);font-size:12px;margin-top:2px">by DeTuCel</div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:32px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.08em">Recuperación de PIN</p>
      <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#fff">Hola, {display_name} 👋</p>
      <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6">
        Recibimos una solicitud para restablecer tu PIN de acceso.<br>
        Ingresa el siguiente código en la pantalla de recuperación:
      </p>

      <!-- Token box -->
      <div style="background:rgba(21,87,245,0.1);border:1.5px solid rgba(21,87,245,0.4);border-radius:14px;padding:24px 20px;text-align:center;margin-bottom:24px">
        <div style="font-size:11px;color:rgba(255,255,255,0.3);font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px">Tu código de restablecimiento</div>
        <div style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:900;letter-spacing:0.35em;color:#fff;text-shadow:0 0 20px rgba(21,87,245,0.6)">{token}</div>
      </div>

      <!-- Warnings -->
      <div style="background:rgba(250,204,21,0.06);border:1px solid rgba(250,204,21,0.2);border-radius:10px;padding:12px 16px;margin-bottom:16px">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.5">
          ⏱&nbsp; Este código <strong style="color:rgba(255,255,255,0.75)">expira en 15 minutos</strong> y solo puede usarse una vez.
        </p>
      </div>
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.28);line-height:1.5">
        Si no solicitaste este cambio, puedes ignorar este correo. Tu PIN actual no se modificará.
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);padding:16px 32px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:11px;color:rgba(255,255,255,0.2)">DeTuCel &copy; 2026</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.2)">noreply@detucel.com</span>
    </div>

  </div>

</body>
</html>
    """

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Recupera tu PIN · Lector Comercial"
        msg["From"]    = f"Lector Comercial <{smtp_user}>"
        msg["To"]      = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))

        if smtp_port == 465:
            import ssl
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, to_email, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.ehlo()
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, to_email, msg.as_string())

        print(f"[Email] Enviado a {to_email}")
        return True
    except Exception as e:
        print(f"[Email] Error: {e}")
        return False
