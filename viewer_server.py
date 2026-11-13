"""제한된 Windows 계정에서 조회 사본만 읽는 독립 서버입니다. PC 앱을 가져오지 않습니다."""
import hashlib
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit

ORIGIN='https://archive.mirnaru.kro.kr'
COOKIE='__Host-butterfly-view'
SESSION_SECONDS=30*86400
ROOT=Path(os.environ.get('BUTTERFLY_VIEWER_ROOT',Path(__file__).resolve().parent)).resolve()


def connect(root):
    db=sqlite3.connect(root/'auth/viewer.sqlite3',timeout=5)
    db.row_factory=sqlite3.Row
    return db


def initialize_auth(root):
    (root/'auth').mkdir(parents=True,exist_ok=True)
    with connect(root) as db:
        existing=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").fetchone()
        if existing and 'purpose' not in {row['name'] for row in db.execute('PRAGMA table_info(sessions)')}:
            with sqlite3.connect(root/'auth'/f'viewer-before-review-{time.time_ns()}.sqlite3') as backup:
                db.backup(backup)
        db.executescript('''CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,code_hash TEXT,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,label TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires REAL NOT NULL);''')
        db.execute('CREATE TABLE IF NOT EXISTS review_code(id INTEGER PRIMARY KEY CHECK(id=1),code_hash TEXT NOT NULL)')
        if 'purpose' not in {row['name'] for row in db.execute('PRAGMA table_info(sessions)')}:
            db.execute("ALTER TABLE sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'personal'")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class ViewerServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address,root):
        self.root=Path(root)
        self.capacity=threading.BoundedSemaphore(12)
        super().__init__(address,ViewerHandler)


class ViewerHandler(BaseHTTPRequestHandler):
    server_version='ButterflyViewer'
    sys_version=''
    protocol_version='HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self,format,*args):
        pass

    def log_request(self,code='-',size='-'):
        # URL의 쿼리·본문·인증 값은 기록하지 않습니다.
        logging.info('%s %s %s %s',self.client_address[0],self.command,urlsplit(self.path).path[:120],code)

    def reply(self,status,value,kind='application/json; charset=utf-8',cookie=None):
        body=value if isinstance(value,bytes) else json.dumps(value,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers()
        if self.command!='HEAD':self.wfile.write(body)

    def authorized(self,db):
        try:
            cookies=SimpleCookie(self.headers.get('Cookie',''))
            token=cookies[COOKIE].value if COOKIE in cookies else ''
        except (CookieError,ValueError):
            return False
        row=db.execute('SELECT enabled FROM config WHERE id=1').fetchone()
        return bool(row and row[0] and db.execute('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?',(digest(token),time.time())).fetchone())

    def do_GET(self):
        self.handle_request(False)

    def do_HEAD(self):
        self.handle_request(False)

    def do_POST(self):
        self.handle_request(True)

    def do_PUT(self):self.reply(405,{'detail':'읽기 전용입니다.'})
    do_PATCH=do_PUT
    do_DELETE=do_PUT
    do_OPTIONS=do_PUT

    def handle_request(self,write):
        if not self.server.capacity.acquire(blocking=False):
            self.reply(503,{'detail':'잠시 후 다시 시도해 주세요.'});return
        try:
            if self.headers.get('Host')!=urlsplit(ORIGIN).netloc or self.headers.get('X-Forwarded-Proto')!='https':
                self.reply(400,{'detail':'지정된 HTTPS 주소로 접속해 주세요.'});return
            path=urlsplit(self.path).path
            if write:
                self.write_auth(path);return
            assets={'/':('index.html','text/html; charset=utf-8'),'/viewer/app.js':('app.js','text/javascript; charset=utf-8'),'/viewer/style.css':('style.css','text/css; charset=utf-8')}
            if path in assets:
                file,kind=assets[path];self.reply(200,(self.server.root/'web'/file).read_bytes(),kind);return
            if path=='/viewer/health':
                self.reply(200,{'role':'readonly-viewer','version':1});return
            with connect(self.server.root) as db:
                if path not in ('/viewer/session','/viewer/data'):
                    self.reply(404,{'detail':'제공하지 않는 기능입니다.'});return
                if not self.authorized(db):
                    self.reply(401,{'detail':'PC에서 발급한 조회 코드를 입력해 주세요.'});return
            if path=='/viewer/session':self.reply(200,{'authenticated':True});return
            target=self.server.root/'snapshots/current.json'
            if not target.is_file():self.reply(503,{'detail':'PC에서 조회용 사본을 먼저 갱신해 주세요.'});return
            self.reply(200,target.read_bytes(),'application/json; charset=utf-8')
        except (sqlite3.Error,OSError,ValueError,TimeoutError):
            self.reply(503,{'detail':'조회 서버 준비 상태를 확인해 주세요.'})
        finally:self.server.capacity.release()

    def write_auth(self,path):
        if path not in ('/viewer/login','/viewer/logout'):
            self.reply(405,{'detail':'외부에서는 조회만 가능합니다.'});return
        if self.headers.get('Origin')!=ORIGIN or self.headers.get('X-Butterfly-Viewer')!='1':
            self.reply(403,{'detail':'조회 화면에서 다시 시도해 주세요.'});return
        size=self.headers.get('Content-Length','')
        if not size.isascii() or not size.isdigit() or int(size)>2048 or self.headers.get('Transfer-Encoding'):
            self.reply(413,{'detail':'요청 크기를 확인해 주세요.'});return
        if self.headers.get_content_type()!='application/json':
            self.reply(415,{'detail':'입력 형식을 확인해 주세요.'});return
        try:
            value=json.loads(self.rfile.read(int(size)))
        except (ValueError,UnicodeError):self.reply(422,{'detail':'입력을 확인해 주세요.'});return
        if not isinstance(value,dict):self.reply(422,{'detail':'입력을 확인해 주세요.'});return
        with connect(self.server.root) as db:
            if path.endswith('/logout'):
                try:
                    cookies=SimpleCookie(self.headers.get('Cookie',''));token=cookies[COOKIE].value if COOKIE in cookies else ''
                except (CookieError,ValueError):token=''
                db.execute('DELETE FROM sessions WHERE token_hash=?',(digest(token),))
                self.reply(200,{'logged_out':True},cookie=COOKIE+'=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict');return
            now=time.time();db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM attempts WHERE expires<?',(now,))
            keys=[('global',60),('client:'+digest(self.client_address[0]),12)]
            for key,maximum in keys:
                count=db.execute('SELECT count FROM attempts WHERE key=?',(key,)).fetchone()
                if count and count[0]>=maximum:
                    self.reply(429,{'detail':'잠시 후 다시 시도해 주세요.'});return
            for key,maximum in keys:
                db.execute('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',(key,now+600))
            db.commit()
            db.execute('BEGIN IMMEDIATE')
            code=value.get('code','');label=value.get('label','내 휴대폰')
            row=db.execute('SELECT * FROM config WHERE id=1').fetchone()
            review=db.execute('SELECT code_hash FROM review_code WHERE id=1').fetchone()
            valid_format=isinstance(code,str) and len(code)==12
            hashed=digest(code.upper()) if valid_format else ''
            is_review=bool(valid_format and review and hmac.compare_digest(review['code_hash'],hashed))
            is_personal=bool(valid_format and row and row['expires']>now and row['code_hash'] and hmac.compare_digest(row['code_hash'],hashed))
            if not row or not row['enabled'] or not (is_review or is_personal):
                self.reply(401,{'detail':'조회 코드가 없거나 만료되었습니다.'});return
            if not isinstance(label,str) or len(label)>80:
                self.reply(422,{'detail':'기기 이름을 확인해 주세요.'});return
            token=secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires<?',(now,))
            purpose='review' if is_review else 'personal'
            if db.execute('SELECT count(*) FROM sessions WHERE purpose=?',(purpose,)).fetchone()[0]>=(100 if is_review else 10):
                self.reply(409,{'detail':'PC에서 기존 조회 연결을 해제해 주세요.'});return
            db.execute('INSERT INTO sessions(token_hash,label,expires,purpose) VALUES(?,?,?,?)',(digest(token),label,now+SESSION_SECONDS,purpose))
            if not is_review:
                db.execute('UPDATE config SET code_hash=NULL,expires=0 WHERE id=1')
        self.reply(200,{'authenticated':True},cookie=f'{COOKIE}={token}; Max-Age={SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict')


if __name__=='__main__':
    (ROOT/'logs').mkdir(exist_ok=True)
    logger=RotatingFileHandler(ROOT/'logs/access.log',maxBytes=2*1024*1024,backupCount=3,encoding='utf-8')
    logging.basicConfig(level=logging.INFO,handlers=[logger],format='%(asctime)s %(message)s')
    # 인증 DB·정적 파일은 PC가 준비합니다. 이 서버에는 원본 DB 경로나 초기화 기능이 없습니다.
    if not (ROOT/'auth/viewer.sqlite3').is_file():raise RuntimeError('PC에서 조회 서버를 준비해 주세요.')
    initialize_auth(ROOT)
    ViewerServer(('127.0.0.1',8010),ROOT).serve_forever()
