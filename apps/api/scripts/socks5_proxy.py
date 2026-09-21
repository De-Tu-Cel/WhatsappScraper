"""
Minimal SOCKS5 proxy server with optional username/password auth.
stdlib only — no extra dependencies.
Usage: python socks5_proxy.py [port] [user] [password]
"""
import socket, threading, select, struct, sys, logging

PORT     = int(sys.argv[1])   if len(sys.argv) > 1 else 1080
USERNAME = sys.argv[2].encode() if len(sys.argv) > 2 else None
PASSWORD = sys.argv[3].encode() if len(sys.argv) > 3 else None
AUTH     = USERNAME is not None

logging.basicConfig(level=logging.INFO, format='[SOCKS5] %(message)s')
log = logging.getLogger()


def relay(src, dst):
    try:
        while True:
            r, _, _ = select.select([src, dst], [], [], 60)
            if not r:
                break
            for s in r:
                data = s.recv(4096)
                if not data:
                    return
                (dst if s is src else src).sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try: s.close()
            except Exception: pass


def handle(client):
    try:
        header = client.recv(2)
        if len(header) < 2 or header[0] != 5:
            return
        nmethods = header[1]
        methods = client.recv(nmethods)

        if AUTH:
            if 2 not in methods:
                client.sendall(b'\x05\xff'); return
            client.sendall(b'\x05\x02')          # request user/pass auth
            ver = client.recv(1)
            if not ver or ver[0] != 1: return
            ulen = client.recv(1)[0]
            user = client.recv(ulen)
            plen = client.recv(1)[0]
            pwd  = client.recv(plen)
            if user != USERNAME or pwd != PASSWORD:
                client.sendall(b'\x01\x01'); return
            client.sendall(b'\x01\x00')          # auth ok
        else:
            client.sendall(b'\x05\x00')          # no auth

        req = client.recv(4)
        if len(req) < 4 or req[1] != 1:
            client.sendall(b'\x05\x07\x00\x01' + b'\x00' * 6); return

        addr_type = req[3]
        if addr_type == 1:
            addr = socket.inet_ntoa(client.recv(4))
        elif addr_type == 3:
            n    = client.recv(1)[0]
            addr = client.recv(n).decode()
        elif addr_type == 4:
            addr = socket.inet_ntop(socket.AF_INET6, client.recv(16))
        else:
            client.sendall(b'\x05\x08\x00\x01' + b'\x00' * 6); return

        port = struct.unpack('!H', client.recv(2))[0]
        remote = socket.create_connection((addr, port), timeout=10)
        bind   = remote.getsockname()
        resp   = (b'\x05\x00\x00\x01'
                  + socket.inet_aton(bind[0] if bind[0] != '0.0.0.0' else '127.0.0.1')
                  + struct.pack('!H', bind[1]))
        client.sendall(resp)
        log.info('CONNECT %s:%d', addr, port)

        t = threading.Thread(target=relay, args=(client, remote), daemon=True)
        t.start()
        relay(remote, client)
    except Exception as e:
        log.debug('error: %s', e)
        try: client.close()
        except Exception: pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('0.0.0.0', PORT))
    srv.listen(64)
    auth_info = f" (auth: {USERNAME.decode()}:***)" if AUTH else " (no auth)"
    log.info('Listening on 0.0.0.0:%d%s', PORT, auth_info)
    while True:
        try:
            client, _ = srv.accept()
            threading.Thread(target=handle, args=(client,), daemon=True).start()
        except KeyboardInterrupt:
            break
    srv.close()

if __name__ == '__main__':
    main()
