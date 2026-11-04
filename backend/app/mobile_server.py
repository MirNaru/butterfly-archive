"""집 안 네트워크 전용 사진 전송 서버입니다. 외부 조회 서버와 분리합니다."""
from contextlib import asynccontextmanager
from pathlib import Path
import sqlite3
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from app.migrations import initialize_database
from app.mobile import remote_router, lan_configuration
from ipaddress import ip_address, ip_network

ASSETS = Path(__file__).with_name('mobile_web')


@asynccontextmanager
async def lifespan(app):
    initialize_database()
    yield


app = FastAPI(title='Butterfly Archive Mobile', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.include_router(remote_router)


@app.middleware('http')
async def protection(request: Request, call_next):
    config=lan_configuration()
    if not config:
        return JSONResponse({'detail':'집 안 전송 서버가 설정되지 않았습니다.'},status_code=503)
    origin=config['url']
    try:
        allowed=any(ip_address(request.client.host) in ip_network(network) for network in config['networks'])
    except ValueError:
        allowed=False
    if not allowed:
        return JSONResponse({'detail':'집 안 네트워크에서만 사진 정보를 보낼 수 있습니다.'},status_code=403)
    if request.headers.get('host') != origin.removeprefix('https://'):
        return JSONResponse({'detail':'허용되지 않은 주소입니다.'},status_code=400)
    if request.url.scheme != 'https':
        return JSONResponse({'detail':'HTTPS 주소로 접속해 주세요.'},status_code=400)
    if request.method not in ('GET','HEAD'):
        if request.headers.get('origin') != origin or request.headers.get('x-butterfly-mobile') != '1':
            return JSONResponse({'detail':'모바일 화면에서 다시 시도해 주세요.'},status_code=403)
        size = request.headers.get('content-length','')
        if not size.isascii() or not size.isdigit() or int(size)>32768:
            return JSONResponse({'detail':'전송 정보 크기를 확인해 주세요.'},status_code=413)
        if request.headers.get('content-type','').split(';')[0] != 'application/json':
            return JSONResponse({'detail':'사진 정보 형식을 확인해 주세요.'},status_code=415)
    response = await call_next(request)
    response.headers.update({
        'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'Permissions-Policy':'geolocation=(), camera=(), microphone=()',
    })
    return response


@app.exception_handler(sqlite3.Error)
async def database_error(request, exc):
    return JSONResponse({'detail':'PC 저장이 지연되었습니다. 잠시 후 다시 시도해 주세요.'},status_code=503)


@app.get('/')
def index():
    return FileResponse(ASSETS/'index.html')


@app.get('/mobile/{name}')
def asset(name: str):
    if name not in ('app.js','metadata.js','style.css'):
        return JSONResponse({'detail':'파일이 없습니다.'},status_code=404)
    return FileResponse(ASSETS/name)
