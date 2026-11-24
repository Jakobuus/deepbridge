from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / '.env')  # repo-root .env (gitignored)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import activity, buyers, competitors, contacts, credits, graph, icp, interview, outreach, paths, pipeline, search
from .store import store

@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    yield

app = FastAPI(title='DeepBridge', version='0.1.0', lifespan=lifespan,
              description='Cached research demo. Publication affiliations are dated; messages are drafts only.')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:3000'],
                   allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
for module in [icp, buyers, graph, paths, outreach, pipeline, credits, search, contacts, competitors, activity, interview]:
    app.include_router(module.router)

@app.get('/health')
def health():
    return {'status': 'ok', 'data': 'cache', 'case': 'Lightmatter / Nicholas C. Harris'}
