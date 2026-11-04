"""PC 실행기의 인증으로 같은 PC의 다른 계정도 기록 API를 임의 호출하지 못하게 합니다."""
import hashlib
import hmac
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from app.database import database_path

router=APIRouter()
COOKIE='butterfly_pc'


def key_path():
    return database_path().parent/'pc-access.key'


def key():
    path=key_path()
    return path.read_text(encoding='ascii').strip() if path.is_file() else None


def authenticated(request):
    secret=key()
    if secret is None:
        return True  # 별도 계정 배포 전의 로컬 개발·시험 DB와 호환합니다.
    try:
        expires,nonce,signature=request.cookies.get(COOKIE,'').split('.')
        expected=hmac.new(secret.encode(),f'{expires}.{nonce}'.encode(),hashlib.sha256).hexdigest()
        return int(expires)>time.time() and hmac.compare_digest(signature,expected)
    except (ValueError,TypeError):
        return False


@router.post('/api/local/session')
def session(request:Request):
    secret=key()
    supplied=request.headers.get('x-butterfly-local','')
    origin=request.headers.get('origin','')
    if secret is None or not hmac.compare_digest(secret,supplied) or origin not in ('','http://127.0.0.1:5173','http://localhost:5173'):
        return JSONResponse({'detail':'PC 실행 파일로 화면을 다시 열어 주세요.'},status_code=401)
    expires=str(int(time.time())+86400)
    nonce=secrets.token_hex(16)
    signature=hmac.new(secret.encode(),f'{expires}.{nonce}'.encode(),hashlib.sha256).hexdigest()
    response=JSONResponse({'authenticated':True})
    response.set_cookie(COOKIE,f'{expires}.{nonce}.{signature}',httponly=True,samesite='strict',max_age=86400,path='/')
    response.headers['Cache-Control']='no-store'
    return response
